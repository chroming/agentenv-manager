import { createHash } from "node:crypto";
import type { RemoteDevice } from "../../../shared/types";
import { z } from "zod";
import type { HistorySource } from "../../../shared/conversationSearch";
import { shellQuote, type SshTransport } from "../../remoteDevices/systemSshTransport";

// Runs via stdin without installing a helper or writing remote files. SQLite reads
// use one read transaction, including committed WAL content, never an immutable copy.
export const remoteHistoryScript = String.raw`
import os, sys, json, hashlib, sqlite3, urllib.parse, datetime, contextlib, base64
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
def suggested_roots():
    if kind != 'default': return []
    home = os.path.expanduser('~')
    env = os.environ
    candidates = []
    if agent == 'codex': candidates = [env.get('CODEX_HOME')]
    elif agent == 'claude-code': candidates = [env.get('CLAUDE_CONFIG_DIR')]
    elif agent == 'trae-cli': candidates = [env.get('TRAECLI_HOME'), os.path.join(env.get('TRAE_HOME',os.path.join(home,'.trae')),'cli')]
    elif agent == 'pi': candidates = [env.get('PI_CODING_AGENT_DIR')]
    elif agent == 'opencode': candidates = [os.path.join(env.get('XDG_DATA_HOME',os.path.join(home,'.local/share')),'opencode')]
    return sorted(set(os.path.abspath(os.path.expanduser(p)) for p in candidates if p and os.path.isdir(os.path.expanduser(p)) and os.path.abspath(os.path.expanduser(p)) != root))
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
    found = False
    for directory in allowed:
        try:
            os.stat(directory)
            found = True
        except FileNotFoundError: pass
        except OSError as error: issues.append(str(error))
    missing = not found and not issues
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
    records.sort(key=lambda r: (r['path'], r.get('sessionId','')))
    revision = hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
    if request.get('inventoryVersion') and request['inventoryVersion'] != revision: raise Exception('History inventory changed during paging; refresh again')
    offset = request.get('offset',0)
    return dict(records=records[offset:offset+500], issues=issues, missing=missing, suggestedRoots=suggested_roots(), inventoryVersion=revision, nextOffset=offset+500 if offset+500<len(records) else None)
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
            version = stamp(path)+':'+(stamp(path+'-wal') if os.path.exists(path+'-wal') else '')
            if request.get('pageVersion') and request['pageVersion'] != version: raise Exception('History changed while reading; refresh again')
            offset = request.get('offset',0)
            for row in db.execute('SELECT id,data FROM message WHERE session_id=? ORDER BY time_created,id LIMIT 128 OFFSET ?',(sid,offset)):
                info = json.loads(row['data']); info['id'] = row['id']
                parts = [json.loads(p['data']) for p in db.execute('SELECT data FROM part WHERE message_id=? ORDER BY time_created,id',(row['id'],))]
                messages.append(dict(info=info,parts=parts))
            after = stamp(path)+':'+(stamp(path+'-wal') if os.path.exists(path+'-wal') else '')
            if version != after: raise Exception('History changed while reading; refresh again')
            return dict(content=json.dumps(dict(messages=messages)),nextOffset=offset+128 if len(messages)==128 else None,version=version)
    before = stamp(path)
    if not request.get('identity') and request.get('expectedVersion') and request['expectedVersion'] != before: raise Exception('History changed after discovery; refresh again')
    if request.get('chunked'):
        offset = request.get('offset',0)
        digest = None
        with open(path, 'rb') as f:
            info = os.fstat(f.fileno())
            identity = str(info.st_dev)+':'+str(info.st_ino)
            size = request.get('snapshotSize',info.st_size)
            if (request.get('identity') and request['identity'] != identity) or info.st_size < size: raise Exception('History changed while reading; refresh again')
            if offset > size: raise Exception('Invalid history chunk offset')
            f.seek(offset); content = f.read(min(4*1024*1024,size-offset))
            eof = offset+len(content) == size
            if eof:
                f.seek(0); remaining = size; hash = hashlib.sha256()
                while remaining:
                    part = f.read(min(4*1024*1024,remaining))
                    if not part: raise Exception('History changed while reading; refresh again')
                    hash.update(part); remaining -= len(part)
                digest = hash.hexdigest()
        return dict(bytes=base64.b64encode(content).decode(),nextOffset=offset+len(content),eof=eof,
            version=request.get('expectedVersion') or before,identity=identity,snapshotSize=size,digest=digest)
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

const remoteRequestPage = async (transport: SshTransport, device: RemoteDevice,
  request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
  signal.throwIfAborted();
  const result = await transport.execute(device, `python3 - ${shellQuote(JSON.stringify(request))}`, {
    input: Buffer.from(remoteHistoryScript), timeoutMs: 120_000,
    maxOutputBytes: 128 * 1024 * 1024, signal
  });
  if (result.exitCode !== 0) throw new Error(result.stderr || "Remote history could not be read. Check SSH access and Python 3 availability.");
  return JSON.parse(result.stdout.toString("utf8"));
};

export const remoteHistoryRequest = async <T>(transport: SshTransport, device: RemoteDevice,
  source: HistorySource, operation: "scan" | "read", signal: AbortSignal,
  record?: RemoteHistoryRecord): Promise<T> => {
  // Retry an unstable inventory/transcript once, never publish a mixture of revisions.
  for (let attempt = 0; ; attempt++) {
    try {
      const base = { ...source, operation, ...(record ? { path: record.path, sessionId: record.sessionId } : {}) };
      if (operation === "read") {
        const chunks: Buffer[] = [];
        const messages: unknown[] = [];
        let offset = 0;
        let version: string | undefined;
        let identity: string | undefined;
        let snapshotSize: number | undefined;
        const digest = createHash("sha256");
        for (;;) {
          const raw = await remoteRequestPage(transport, device, { ...base, chunked: true, offset,
            expectedVersion: version ?? (attempt === 0 ? record?.fileVersion ?? record?.version : undefined),
            pageVersion: version, identity, snapshotSize }, signal);
          const page = z.object({ content: z.string().optional(), bytes: z.string().optional(),
            nextOffset: z.number().int().nonnegative().nullish(), eof: z.boolean().optional(),
            version: z.string().optional(), identity:z.string().optional(), snapshotSize:z.number().int().nonnegative().optional(), digest:z.string().nullish() }).parse(raw);
          if (page.bytes !== undefined) {
            const chunk = Buffer.from(page.bytes, "base64");
            if (version && page.version !== version) throw new Error("History changed while reading; refresh again");
            if (identity && (page.identity !== identity || page.snapshotSize !== snapshotSize)) throw new Error("History changed while reading; refresh again");
            chunks.push(chunk);
            digest.update(chunk);
            if (page.eof) {
              if (page.digest && digest.digest("hex") !== page.digest) throw new Error("History changed while reading; refresh again");
              return { content: Buffer.concat(chunks).toString("utf8") } as T;
            }
            identity = page.identity;
            snapshotSize = page.snapshotSize;
            if (!page.version || page.nextOffset !== offset + chunk.length || !chunk.length) throw new Error("Invalid history chunk; retry refresh.");
          } else {
            if (page.content === undefined) throw new Error("History response has no content.");
            if (!version && page.nextOffset == null) return { content: page.content } as T;
            if (version && page.version !== version) throw new Error("History changed while reading; refresh again");
            messages.push(...z.object({ messages: z.array(z.unknown()) }).parse(JSON.parse(page.content)).messages);
            if (page.nextOffset == null) return { content: JSON.stringify({ messages }) } as T;
          }
          if (page.nextOffset == null || page.nextOffset <= offset || !page.version) throw new Error("Invalid history page; retry refresh.");
          offset = page.nextOffset;
          version = page.version;
        }
      }
      const records: RemoteHistoryRecord[] = [];
      const issues = new Set<string>();
      const suggestedRoots = new Set<string>();
      let offset = 0;
      let inventoryVersion: string | undefined;
      let missing = false;
      for (;;) {
        const raw = await remoteRequestPage(transport, device, { ...base, offset, inventoryVersion }, signal);
        const page = z.object({ records: z.array(z.unknown()), issues: z.array(z.string()),
          missing: z.boolean().optional(), suggestedRoots: z.array(z.string().max(4096)).optional(), inventoryVersion: z.string().optional(),
          nextOffset: z.number().int().nonnegative().nullish() }).parse(raw);
        if (inventoryVersion && inventoryVersion !== page.inventoryVersion) throw new Error("History inventory changed during paging; refresh again");
        page.issues.forEach((issue) => issues.add(issue));
        page.suggestedRoots?.filter((path) => path.startsWith("/") && !path.includes("\\0")).forEach((path) => suggestedRoots.add(path));
        for (const record of page.records) {
          const parsed = remoteRecordSchema.safeParse(record);
          if (!parsed.success) {
            issues.add("A history entry has unsupported metadata; readable histories were kept.");
            continue;
          }
          const data = parsed.data;
          records.push({ ...data, updatedAt: new Date(data.updatedAt).toISOString(), title: data.title ?? undefined,
            workspacePath: data.workspacePath ?? undefined, snippet: data.snippet ?? undefined });
        }
        missing = Boolean(page.missing);
        if (page.nextOffset == null) return { records, issues: [...issues], missing, suggestedRoots: [...suggestedRoots] } as T;
        if (page.nextOffset <= offset || !page.inventoryVersion) throw new Error("Invalid history inventory page; retry refresh.");
        offset = page.nextOffset;
        inventoryVersion = page.inventoryVersion;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (attempt >= 1 || !/History (?:inventory )?changed/.test(String(error))) throw error;
    }
  }
};
