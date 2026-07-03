import {
  addClip,
  clearRoom,
  deleteClip,
  getRoom,
  registerDevice,
  updateDraft,
} from "@/lib/share-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoomContext = {
  params: Promise<{
    roomId: string;
  }>;
};

function errorResponse(error: unknown, status = 400) {
  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  return Response.json({ error: message }, { status });
}

export async function GET(_request: Request, context: RoomContext) {
  try {
    const { roomId } = await context.params;
    const room = await getRoom(roomId);

    return Response.json({ room });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RoomContext) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json()) as { draft?: unknown };
    const room = await updateDraft(roomId, body.draft ?? "");

    return Response.json({ room });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RoomContext) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json()) as { text?: unknown };
    const room = await addClip(roomId, body.text);

    return Response.json({ room }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RoomContext) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json()) as {
      deviceId?: unknown;
      deviceName?: unknown;
    };
    const room = await registerDevice(roomId, {
      id: body.deviceId,
      name: body.deviceName,
    });

    return Response.json({ room });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RoomContext) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      clipId?: unknown;
      clear?: unknown;
    };

    const room = body.clear
      ? await clearRoom(roomId)
      : await deleteClip(roomId, body.clipId);

    return Response.json({ room });
  } catch (error) {
    return errorResponse(error);
  }
}
