import { NextResponse } from "next/server";

export function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: { message, code } }, { status });
}
