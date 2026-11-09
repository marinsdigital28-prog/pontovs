import { handle } from '../../../../../lib/auto-close-cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 08:00 Brasília: re-checa ontem para quem tem escala terminando depois das 17:20. */
export async function GET(request: Request) { return handle(request, 'MANHA'); }
