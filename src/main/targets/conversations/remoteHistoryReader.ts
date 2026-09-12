import type { RemoteDevice } from "../../../shared/types";
import { z } from "zod";
import type { HistorySource } from "../../../shared/conversationSearch";
import { shellQuote, type SshTransport } from "../../remoteDevices/systemSshTransport";

// Runs via stdin without installing a helper or writing remote files. SQLite reads
// use one read transaction, including committed WAL content, never an immutable copy.
export const remoteHistoryScript = String.raw`
import os, sys, json, hashlib, sqlite3, urllib.parse, datetime, contextlib
request = json.loads(sys.argv[1])
agent = request['agentId']
root = os.path.abspath(os.path.expanduser(request['root']))
kind = request['kind']
def roots():
    if kind == 'directory': return [root]
    if agent == 'codex': return [os.path.join(root,'sessions'), os.path.join(root,'archived_sessions')]
    if agent == 'claude-code': return [os.path.join(root,'projects')]
    if agent == 'trae-cli': return [os.path.join(root,'sessions'), os.path.join(root,'archived_sessions')]
    if agent == 'pi': return [os.path.join(root,'sessions')]
    return [root]
allowed = roots()
def contained(path):
    actual = os.path.realpath(path)
    return any(os.path.commonpath([actual, os.path.realpath(r)]) == os.path.realpath(r) for r in allowed)
def stamp(path):
    s = os.stat(path)
    return str(s.st_size)+':'+str(s.st_mtime_ns)+':'+str(s.st_ino)
def database(path):
    if not contained(path): raise Exception('Database link leaves approved history source')
    db = sqlite3.connect('file:'+urllib.parse.quote(path)+'?mode=ro', uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    return db
def iso(value):
    return datetime.datetime.fromtimestamp(value/1000, datetime.timezone.utc).isoformat()
def scan():
    records, issues, seen = [], [], set()
    titles, summaries, workspaces = {}, {}, {}
    if agent == 'codex' and kind == 'default':
        try:
            metadata = os.path.join(root, 'session_index.jsonl')
            if os.path.commonpath([os.path.realpath(metadata), os.path.realpath(root)]) != os.path.realpath(root): raise Exception('Native title index leaves approved source')
            with open(metadata, encoding='utf-8') as f:
                for line in f:
                    try:
                        row = json.loads(line); titles[row['id']] = row.get('thread_name') or row.get('title')
                    except Exception: pass
        except FileNotFoundError: pass
        except Exception as e: issues.append('Native titles could not be read: '+str(e))
    if agent.startswith('antigravity'):
        try:
            metadata = os.path.join(root, 'cache', 'last_conversations.json')
            if not contained(metadata): raise Exception('Workspace metadata leaves approved source')
            with open(metadata, encoding='utf-8') as f:
                workspaces = {v:k for k,v in json.load(f).items()}
        except FileNotFoundError: pass
        except Exception as e: issues.append('Workspace metadata could not be read: '+str(e))
        dbpath = os.path.join(root,'conversation_summaries.db')
        if os.path.isfile(dbpath):
            try:
                with contextlib.closing(database(dbpath)) as db:
                    for row in db.execute('SELECT * FROM conversation_summaries'):
                        d = dict(row); sid = str(d['conversation_id'])
                        uri = json.loads(d.get('workspace_uris') or '[]')
                        workspace = workspaces.get(sid) or (urllib.parse.unquote(urllib.parse.urlparse(uri[0]).path) if uri else None)
                        modified = d['last_modified_time']
                        updated = iso(modified if modified > 100000000000 else modified*1000) if isinstance(modified,(int,float)) else str(modified)
                        summaries[sid] = dict(path=dbpath,sessionId=sid,title=d.get('title'),snippet=d.get('preview'),workspacePath=workspace,updatedAt=updated,version=str(modified)+':'+str(d.get('step_count')),detailState='summary-only')
            except Exception as e: issues.append(dbpath+': '+str(e))
    if not any(os.path.isdir(d) for d in allowed): issues.append('No history directory found. Check the source path or add the runtime history directory.')
    def problem(error): issues.append(str(error))
    for directory in allowed:
        if not os.path.exists(directory): continue
        for folder, dirs, files in os.walk(directory, followlinks=True, onerror=problem):
            real = os.path.realpath(folder)
            if real in seen: dirs[:] = []; continue
            seen.add(real)
            if not contained(folder):
                issues.append('Linked history directory is outside the selected scope: '+folder)
                dirs[:] = []; continue
            dirs[:] = [d for d in dirs if not d.endswith('.artifacts') and d != 'background-tasks']
            for name in sorted(files):
                path = os.path.join(folder, name)
                if not contained(path):
                    if name.endswith('.jsonl'): issues.append('History link is outside the selected scope: '+path)
                    continue
                try:
                    if name.endswith('.jsonl'):
                        if agent in ['codex','trae-cli'] and not name.startswith('rollout-'): continue
                        if agent.startswith('antigravity') and name != 'transcript.jsonl': continue
                        if name in ['history.jsonl','session_index.jsonl']: continue
                        s = os.stat(path)
                        record = dict(path=path, version=stamp(path), size=s.st_size, updatedAt=iso(s.st_mtime*1000))
                        if agent == 'codex':
                            sid = name[-42:-6]
                            if titles.get(sid): record['title'] = titles[sid]
                        if agent.startswith('antigravity'):
                            sid = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(path))))
                            summary = summaries.pop(sid, {})
                            record.update(sessionId=sid,title=summary.get('title'),workspacePath=workspaces.get(sid) or summary.get('workspacePath'))
                        record['fileVersion'] = record['version']
                        record['version'] += ':'+hashlib.sha256(json.dumps([record.get('title'),record.get('workspacePath')]).encode()).hexdigest()
                        records.append(record)
                    elif agent == 'opencode' and name.startswith('opencode') and name.endswith('.db'):
                        with contextlib.closing(database(path)) as db:
                            for row in db.execute('SELECT id,title,directory,time_created,time_updated FROM session'):
                                data = dict(row)
                                records.append(dict(path=path, sessionId=data['id'], title=data['title'], workspacePath=data['directory'], version=stamp(path)+':'+(stamp(path+'-wal') if os.path.exists(path+'-wal') else '')+':'+str(data['time_updated']), updatedAt=iso(data['time_updated'])))
                    elif agent == 'opencode' and name.endswith('.json') and '/storage/session/' in path:
                        with open(path,encoding='utf-8') as f: data = json.load(f)
                        storage = path.split('/session/')[0]
                        sid = data['id']; version = [stamp(path)]
                        for child in [os.path.join(storage,'message',sid), os.path.join(storage,'part')]:
                            for p,ds,fs in os.walk(child):
                                for n in sorted(fs):
                                    q = os.path.join(p,n)
                                    if contained(q): version.append(q+':'+stamp(q))
                        records.append(dict(path=path,sessionId=sid,title=data.get('title'),workspacePath=data.get('directory'),version=hashlib.sha256('|'.join(version).encode()).hexdigest(),updatedAt=iso(data.get('time',{}).get('updated',os.stat(path).st_mtime*1000))))
                except Exception as e: issues.append(path+': '+str(e))
    records.extend(summaries.values())
    return dict(records=records, issues=issues)
def read():
    path = request['path']
    if not contained(path): raise Exception('History path is outside the approved source')
    if request.get('sessionId') and agent == 'opencode' and path.endswith('.json'):
        storage = path.split('/session/')[0]; messages = []
        message_root = os.path.join(storage,'message',request['sessionId'])
        for folder,dirs,files in os.walk(message_root):
            for name in sorted(files):
                p = os.path.join(folder,name)
                if not contained(p): raise Exception('Message link leaves approved history source')
                with open(p,encoding='utf-8') as f: info = json.load(f)
                parts = []
                for parent,ds,fs in os.walk(os.path.join(storage,'part',info['id'])):
                    for part in sorted(fs):
                        p = os.path.join(parent,part)
                        if not contained(p): raise Exception('Part link leaves approved history source')
                        with open(p,encoding='utf-8') as f: parts.append(json.load(f))
                messages.append(dict(info=info,parts=parts))
        return dict(content=json.dumps(dict(messages=messages)))
    if request.get('sessionId') and agent == 'opencode':
        with contextlib.closing(database(path)) as db:
            sid = request['sessionId']
            messages = []
            for row in db.execute('SELECT id,data FROM message WHERE session_id=? ORDER BY time_created,id',(sid,)):
                info = json.loads(row['data']); info['id'] = row['id']
                parts = [json.loads(p['data']) for p in db.execute('SELECT data FROM part WHERE message_id=? ORDER BY time_created,id',(row['id'],))]
                messages.append(dict(info=info,parts=parts))
            return dict(content=json.dumps(dict(messages=messages)))
    before = stamp(path)
    if request.get('expectedVersion') and request['expectedVersion'] != before: raise Exception('History changed after discovery; refresh again')
    with open(path, 'r', encoding='utf-8') as f: content = f.read()
    if before != stamp(path): raise Exception('History changed while reading; refresh again')
    return dict(content=content)
try:
    print(json.dumps(scan() if request['operation']=='scan' else read()))
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)
`;

export interface RemoteHistoryRecord {
  path: string; version: string; updatedAt: string; size?: number;
  fileVersion?: string;
  sessionId?: string; title?: string; workspacePath?: string;
  snippet?: string; detailState?: "full" | "summary-only";
}
const remoteRecordSchema = z.object({
  path: z.string().min(1).max(4096), version: z.string().min(1).max(4096), updatedAt: z.string().max(128).refine((value)=>Number.isFinite(Date.parse(value))),
  size: z.number().nonnegative().optional(), sessionId: z.string().max(1024).optional(),
  fileVersion: z.string().max(4096).optional(),
  title: z.string().max(65536).nullish(), workspacePath: z.string().max(4096).nullish(),
  snippet: z.string().nullish(), detailState: z.enum(["full", "summary-only"]).optional()
});

export const remoteHistoryRequest = async <T>(transport: SshTransport, device: RemoteDevice,
  source: HistorySource, operation: "scan" | "read", signal: AbortSignal,
  record?: RemoteHistoryRecord): Promise<T> => {
  const request = { ...source, operation, ...(record ? { path: record.path, sessionId: record.sessionId, expectedVersion: record.fileVersion ?? record.version } : {}) };
  const result = await transport.execute(device,
    `python3 - ${shellQuote(JSON.stringify(request))}`, {
      input: Buffer.from(remoteHistoryScript), timeoutMs: 120_000,
      maxOutputBytes: 128 * 1024 * 1024, signal
    });
  if (result.exitCode !== 0) throw new Error(result.stderr || "Remote history could not be read. Check SSH access and Python 3 availability.");
  const value = JSON.parse(result.stdout.toString("utf8"));
  if (operation === "read") return z.object({ content: z.string() }).parse(value) as T;
  const inventory = z.object({ records: z.array(z.unknown()), issues: z.array(z.string()) }).parse(value);
  const records = inventory.records.flatMap((record, index) => {
    const parsed = remoteRecordSchema.safeParse(record);
    if (!parsed.success) {
      inventory.issues.push(`History entry ${index + 1} has unsupported metadata; readable histories were kept.`);
      return [];
    }
    const data = parsed.data;
    return [{ ...data, updatedAt: new Date(data.updatedAt).toISOString(), title: data.title ?? undefined, workspacePath: data.workspacePath ?? undefined, snippet: data.snippet ?? undefined }];
  });
  return { records, issues: inventory.issues } as T;
};
