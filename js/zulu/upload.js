import { supabase } from "../supabaseClient.js";

import {
  sleep,
  formatBytes
} from "./utils.js";


const LARGE_FILE_THRESHOLD =
  500 * 1024 * 1024; // 500 MiB

const LARGE_FILE_PART_SIZE =
  100 * 1024 * 1024; // 100 MiB

const LARGE_FILE_MAX_RETRIES = 5;

const LARGE_FILE_RETRY_BASE_DELAY = 1500;


export function isLargeFile(file) {
  return file.size >= LARGE_FILE_THRESHOLD;
}


function reportProgress(
  onProgress,
  loaded,
  total
) {
  const percent =
    total > 0
      ? (loaded / total) * 100
      : 0;

  onProgress?.({
    percent,
    loaded,
    total,
    text:
      `${percent.toFixed(1)}% — ` +
      `${formatBytes(loaded)} / ` +
      `${formatBytes(total)}`
  });
}


async function calculateBlobSha1(blob) {
  const buffer =
    await blob.arrayBuffer();

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-1",
      buffer
    );

  return [...new Uint8Array(hashBuffer)]
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}


function encodeB2Filename(filename) {
  return encodeURIComponent(filename)
    .replace(
      /[!'()*]/g,
      char =>
        "%" +
        char
          .charCodeAt(0)
          .toString(16)
          .toUpperCase()
    );
}


export async function calculateFileSha1(file) {
  return calculateBlobSha1(file);
}
