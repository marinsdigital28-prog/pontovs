'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isScheduledDay, parseWorkDays } from '@/lib/timesheet-schedule';
import { resolveDaySchedule } from '@/lib/day-schedule';
import { getOperationalAbono, operationalJustifiedMinutes, shouldHidePunchesForDay } from '@/lib/operational-abonos';
import { filterPunchesOutsideCertificates } from '@/lib/certificate-conflicts';

/** Temporary note: full panel restored — punches inside approved certificate windows are excluded from worked time. */
export { default } from './folha-ponto-panel-impl';
