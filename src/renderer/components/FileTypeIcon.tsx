import defaultFileUrl from "../assets/file-icons/default_file.svg";
import defaultFolderUrl from "../assets/file-icons/default_folder.svg";
import defaultFolderOpenedUrl from "../assets/file-icons/default_folder_opened.svg";
import cssUrl from "../assets/file-icons/file_type_css.svg";
import dockerUrl from "../assets/file-icons/file_type_docker.svg";
import dotenvUrl from "../assets/file-icons/file_type_dotenv.svg";
import gitUrl from "../assets/file-icons/file_type_git.svg";
import htmlUrl from "../assets/file-icons/file_type_html.svg";
import imageUrl from "../assets/file-icons/file_type_image.svg";
import iniUrl from "../assets/file-icons/file_type_ini.svg";
import javascriptUrl from "../assets/file-icons/file_type_js.svg";
import jsonUrl from "../assets/file-icons/file_type_json.svg";
import licenseUrl from "../assets/file-icons/file_type_license.svg";
import markdownUrl from "../assets/file-icons/file_type_markdown.svg";
import nodeUrl from "../assets/file-icons/file_type_node.svg";
import pdfUrl from "../assets/file-icons/file_type_pdf.svg";
import pythonUrl from "../assets/file-icons/file_type_python.svg";
import reactJavascriptUrl from "../assets/file-icons/file_type_reactjs.svg";
import reactTypescriptUrl from "../assets/file-icons/file_type_reactts.svg";
import shellUrl from "../assets/file-icons/file_type_shell.svg";
import sqlUrl from "../assets/file-icons/file_type_sql.svg";
import sqliteUrl from "../assets/file-icons/file_type_sqlite.svg";
import textUrl from "../assets/file-icons/file_type_text.svg";
import tomlUrl from "../assets/file-icons/file_type_toml.svg";
import typescriptUrl from "../assets/file-icons/file_type_typescript.svg";
import xmlUrl from "../assets/file-icons/file_type_xml.svg";
import yamlUrl from "../assets/file-icons/file_type_yaml.svg";
import zipUrl from "../assets/file-icons/file_type_zip.svg";
import configFolderUrl from "../assets/file-icons/folder_type_config.svg";
import configFolderOpenedUrl from "../assets/file-icons/folder_type_config_opened.svg";
import docsFolderUrl from "../assets/file-icons/folder_type_docs.svg";
import docsFolderOpenedUrl from "../assets/file-icons/folder_type_docs_opened.svg";
import githubFolderUrl from "../assets/file-icons/folder_type_github.svg";
import githubFolderOpenedUrl from "../assets/file-icons/folder_type_github_opened.svg";
import imagesFolderUrl from "../assets/file-icons/folder_type_images.svg";
import imagesFolderOpenedUrl from "../assets/file-icons/folder_type_images_opened.svg";
import scriptFolderUrl from "../assets/file-icons/folder_type_script.svg";
import scriptFolderOpenedUrl from "../assets/file-icons/folder_type_script_opened.svg";
import sourceFolderUrl from "../assets/file-icons/folder_type_src.svg";
import sourceFolderOpenedUrl from "../assets/file-icons/folder_type_src_opened.svg";
import testFolderUrl from "../assets/file-icons/folder_type_test.svg";
import testFolderOpenedUrl from "../assets/file-icons/folder_type_test_opened.svg";

type FileIconKind =
  | "css"
  | "docker"
  | "dotenv"
  | "file"
  | "git"
  | "html"
  | "image"
  | "ini"
  | "javascript"
  | "json"
  | "license"
  | "markdown"
  | "node"
  | "pdf"
  | "python"
  | "react-javascript"
  | "react-typescript"
  | "shell"
  | "sql"
  | "sqlite"
  | "text"
  | "toml"
  | "typescript"
  | "xml"
  | "yaml"
  | "zip";

type FolderIconKind =
  | "config"
  | "docs"
  | "folder"
  | "github"
  | "images"
  | "script"
  | "source"
  | "test";

const fileIconUrls: Record<FileIconKind, string> = {
  css: cssUrl,
  docker: dockerUrl,
  dotenv: dotenvUrl,
  file: defaultFileUrl,
  git: gitUrl,
  html: htmlUrl,
  image: imageUrl,
  ini: iniUrl,
  javascript: javascriptUrl,
  json: jsonUrl,
  license: licenseUrl,
  markdown: markdownUrl,
  node: nodeUrl,
  pdf: pdfUrl,
  python: pythonUrl,
  "react-javascript": reactJavascriptUrl,
  "react-typescript": reactTypescriptUrl,
  shell: shellUrl,
  sql: sqlUrl,
  sqlite: sqliteUrl,
  text: textUrl,
  toml: tomlUrl,
  typescript: typescriptUrl,
  xml: xmlUrl,
  yaml: yamlUrl,
  zip: zipUrl
};

const folderIconUrls: Record<FolderIconKind, [closed: string, opened: string]> = {
  config: [configFolderUrl, configFolderOpenedUrl],
  docs: [docsFolderUrl, docsFolderOpenedUrl],
  folder: [defaultFolderUrl, defaultFolderOpenedUrl],
  github: [githubFolderUrl, githubFolderOpenedUrl],
  images: [imagesFolderUrl, imagesFolderOpenedUrl],
  script: [scriptFolderUrl, scriptFolderOpenedUrl],
  source: [sourceFolderUrl, sourceFolderOpenedUrl],
  test: [testFolderUrl, testFolderOpenedUrl]
};

const basenameFor = (path: string) =>
  path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";

const extensionFor = (name: string) => {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1) : "";
};

export const fileIconKindForPath = (path: string): FileIconKind => {
  const name = basenameFor(path);
  const extension = extensionFor(name);

  if (/^dockerfile(?:\.|$)/.test(name) || /^containerfile(?:\.|$)/.test(name)) return "docker";
  if (name === "license" || name.startsWith("license.") || name === "copying") return "license";
  if (name === ".gitignore" || name === ".gitattributes" || name === ".gitmodules") return "git";
  if (name === ".env" || name.startsWith(".env.")) return "dotenv";
  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].includes(name)) {
    return "node";
  }

  if (["md", "mdx", "markdown"].includes(extension)) return "markdown";
  if (["json", "jsonc", "json5"].includes(extension)) return "json";
  if (["yaml", "yml"].includes(extension)) return "yaml";
  if (extension === "toml") return "toml";
  if (extension === "tsx") return "react-typescript";
  if (extension === "jsx") return "react-javascript";
  if (["ts", "mts", "cts"].includes(extension) || name.endsWith(".d.ts")) return "typescript";
  if (["js", "mjs", "cjs"].includes(extension)) return "javascript";
  if (["py", "pyi"].includes(extension)) return "python";
  if (["sh", "bash", "zsh", "fish"].includes(extension)) return "shell";
  if (["html", "htm"].includes(extension)) return "html";
  if (["css", "scss", "sass", "less"].includes(extension)) return "css";
  if (["svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"].includes(extension)) {
    return "image";
  }
  if (["xml", "plist"].includes(extension)) return "xml";
  if (["ini", "cfg", "conf", "properties"].includes(extension)) return "ini";
  if (extension === "sql") return "sql";
  if (["sqlite", "sqlite3", "db"].includes(extension)) return "sqlite";
  if (["zip", "tar", "gz", "tgz", "bz2", "7z"].includes(extension)) return "zip";
  if (extension === "pdf") return "pdf";
  if (["txt", "log"].includes(extension)) return "text";
  return "file";
};

export const folderIconKindForPath = (path: string): FolderIconKind => {
  const name = basenameFor(path);
  if (["references", "reference", "docs", "doc", "documentation"].includes(name)) return "docs";
  if (["src", "source", "sources", "lib"].includes(name)) return "source";
  if (["assets", "images", "image", "media"].includes(name)) return "images";
  if (["scripts", "script", "bin"].includes(name)) return "script";
  if (["tests", "test", "spec", "specs", "__tests__"].includes(name)) return "test";
  if (["config", "configs", ".config", "settings"].includes(name)) return "config";
  if (name === ".github") return "github";
  return "folder";
};

interface FileTypeIconProps {
  expanded?: boolean;
  kind: "directory" | "file";
  path: string;
}

export const FileTypeIcon = ({ expanded = false, kind, path }: FileTypeIconProps) => {
  const iconKind = kind === "directory" ? folderIconKindForPath(path) : fileIconKindForPath(path);
  const source = kind === "directory"
    ? folderIconUrls[iconKind as FolderIconKind][expanded ? 1 : 0]
    : fileIconUrls[iconKind as FileIconKind];

  return (
    <img
      alt=""
      aria-hidden="true"
      className="file-type-icon"
      data-file-icon={iconKind}
      draggable={false}
      src={source}
    />
  );
};
