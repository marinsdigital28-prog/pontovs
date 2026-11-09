import { handle } from '../../../../lib/auto-close-cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 17:20 Brasília (20:20 UTC): verifica o dia de hoje. */
export async function GET(request: Request) { return handle(request); }
