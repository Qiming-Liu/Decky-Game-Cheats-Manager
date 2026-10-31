import { useSyncExternalStore } from "react";
import { DownloadJob, getDownloads } from "../utils/backend";
import { invalidateLibrary } from "./useLibrary";

let jobs: DownloadJob[] = [];
let timer: number | undefined;
let generation = 0;
let request = 0;
let completed = "";
const listeners = new Set<() => void>();
const publish = (next: DownloadJob[]) => { jobs = next; listeners.forEach((listener) => listener()); };

async function poll(epoch: number) {
  const id = ++request;
  try {
    const next = await getDownloads();
    if (epoch !== generation || id !== request) return;
    publish(next);
    const signature = next.filter((job) => job.state === "done").map((job) => job.id).sort().join(",");
    if (signature !== completed) {
      completed = signature;
      invalidateLibrary();
    }
  } catch {
    // Temporary RPC errors do not stop synchronization.
  } finally {
    if (epoch === generation && listeners.size) timer = window.setTimeout(() => { void poll(epoch); }, 1500);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) void poll(++generation);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { generation++; window.clearTimeout(timer); }
  };
}

export function trackDownload(job: DownloadJob) {
  request++; // Discard a poll response started before this action.
  publish([...jobs.filter((item) => item.id !== job.id), job]);
}

export const useDownloads = () => useSyncExternalStore(subscribe, () => jobs);
