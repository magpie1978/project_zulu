export function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


export function formatVideoQuality(
  width,
  height
) {
  const w = Number(width || 0);
  const h = Number(height || 0);

  if (!w || !h) {
    return "";
  }

  return `${h}p`;
}


export function formatVideoDuration(seconds) {
  const totalSeconds =
    Math.round(
      Number(seconds || 0)
    );

  if (!totalSeconds) {
    return "";
  }

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const secs =
    totalSeconds % 60;

  if (hours > 0) {
    return [
      hours,
      String(minutes).padStart(2, "0"),
      String(secs).padStart(2, "0")
    ].join(":");
  }

  return [
    minutes,
    String(secs).padStart(2, "0")
  ].join(":");
}


export function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  let value = bytes;
  let unit = 0;

  while (
    value >= 1024 &&
    unit < units.length - 1
  ) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}


export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
