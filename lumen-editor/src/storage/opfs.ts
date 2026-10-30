// Almacenamiento de medios en el Origin Private File System (OPFS).
// Aquí guardamos los archivos importados; el modelo solo guarda la ruta.
// En el hilo principal usamos createWritable(); para lectura aleatoria rápida
// desde workers se usará createSyncAccessHandle() más adelante.

async function getFileHandle(
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Ruta OPFS inválida: ${path}`);

  let dir = await navigator.storage.getDirectory();
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir.getFileHandle(fileName, { create });
}

/** Escribe un Blob/File en OPFS, creando los directorios necesarios. */
export async function writeToOPFS(path: string, data: Blob): Promise<void> {
  const handle = await getFileHandle(path, true);
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** Lee un archivo previamente guardado en OPFS. */
export async function readFromOPFS(path: string): Promise<File> {
  const handle = await getFileHandle(path, false);
  return handle.getFile();
}

/** Elimina un archivo de OPFS (p.ej. al borrar un asset). */
export async function deleteFromOPFS(path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: false });
  await dir.removeEntry(fileName);
}
