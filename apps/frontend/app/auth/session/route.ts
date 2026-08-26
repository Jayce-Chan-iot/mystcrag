import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, projectSessionState } from "../../../src/lib/auth/auth0-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth0Client = getAuth0Client();
    const session = await auth0Client.getSession(request);
    const projected = projectSessionState(session);

    return NextResponse.json(projected, {
      headers: {
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
      }
    });
  } catch (error) {
    console.error("Session handler error:", error);
    return NextResponse.json(
      { authenticated: false },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }
}
