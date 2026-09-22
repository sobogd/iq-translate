import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";

export const runtime = "nodejs";

// Who the session cookie belongs to. The header only knows the yes/no hint
// cookie; this is how the account dropdown shows which address is signed in.
// Returns null when no valid session is present.
export async function GET(req: Request) {
  const email = await resolveOwner(req);
  return NextResponse.json({ email });
}
