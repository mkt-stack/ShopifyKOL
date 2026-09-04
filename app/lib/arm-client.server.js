const DEFAULT_BASE_URL = "https://white-band-9893.tantus-c.workers.dev";

function getBaseUrl() {
  return process.env.ARM_BASE_URL || DEFAULT_BASE_URL;
}

async function armPost(path, body) {
  const token = process.env.ARM_ADMIN_TOKEN;

  if (!token) {
    return {
      ok: false,
      status: 0,
      json: { code: "ARM_NOT_CONFIGURED", message: "ARM_ADMIN_TOKEN is not set" },
    };
  }

  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": token,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: { code: "ARM_UNREACHABLE", message: String(error) },
    };
  }
}

// Looks up a KOL's ARM profile (Internal ID / "affiliate number", handles,
// per-handle registration dates) by LINE UID first (ARM's primary identity),
// falling back to email. Returns null if not registered in ARM yet, or if
// the lookup fails for any reason — this is a read-heavy display feature,
// not a write-critical path, so callers should render "—" rather than
// surface an error.
export async function fetchArmProfile({ lineUid, email }) {
  if (lineUid) {
    const r = await armPost("/fetch-profile", {
      identifier_type: "line_uid",
      identifier_value: lineUid,
    });
    if (r.ok) return r.json;
  }

  if (email) {
    const r = await armPost("/fetch-profile", {
      identifier_type: "email",
      identifier_value: email,
    });
    if (r.ok) return r.json;
  }

  return null;
}

// ARM's profile blob stores each platform's handles as an array — a person
// can register more than one handle per platform (see PROJECT_CONTEXT.md's
// profile blob shape). "Editing" a handle isn't really ARM's model; this
// derives the best-effort single "affiliate registration date" as the
// earliest registered_at across every populated handle, since ARM has no
// top-level join-date field yet.
export function estimateRegistrationDate(armProfile) {
  if (!armProfile?.handles) return null;

  let earliest = null;
  for (const channel of Object.values(armProfile.handles)) {
    for (const entry of channel?.data || []) {
      if (!entry?.registered_at) continue;
      const t = new Date(entry.registered_at).getTime();
      if (Number.isNaN(t)) continue;
      if (earliest === null || t < earliest) earliest = t;
    }
  }

  return earliest === null ? null : new Date(earliest).toISOString();
}

const HANDLE_TYPES = ["tiktok", "shopee", "lazada", "affiliate_plus"];

export function isValidHandleType(type) {
  return HANDLE_TYPES.includes(type);
}

// Registers an additional handle for a platform via ARM's existing
// /add-handle route (live format + duplicate validation happens there).
// Always adds rather than replaces, matching ARM's array-per-platform model.
export async function addArmHandle({ lineUid, handleType, handleValue }) {
  if (!lineUid) {
    return {
      ok: false,
      code: "LINE_UID_REQUIRED",
      message: "ไม่พบข้อมูลบัญชี LINE ของคุณ กรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมิน",
    };
  }

  if (!isValidHandleType(handleType) || !handleValue) {
    return {
      ok: false,
      code: "INVALID_HANDLE",
      message: "ข้อมูลบัญชีไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมิน",
    };
  }

  const r = await armPost("/add-handle", {
    line_uid: lineUid,
    handle_type: handleType,
    handle_value: handleValue,
  });

  if (!r.json) {
    return {
      ok: false,
      code: "ARM_UNREACHABLE",
      message: "เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    };
  }

  return { ok: r.json.valid === true, ...r.json };
}
