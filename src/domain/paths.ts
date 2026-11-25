// Linux paths as plain text.

export const folderOf = (path: string): string => path.slice(0, path.lastIndexOf("/")) || "/";
export const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** True when `path` is `folder` itself or lies inside it. */
export const isWithin = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
