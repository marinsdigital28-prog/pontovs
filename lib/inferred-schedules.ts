export type InferredSchedule = {
  workDays: string;
  scheduleStart: string;
  scheduleEnd: string;
  regime: 'INTEGRAL' | 'MEIO_EXPEDIENTE';
};

export const INFERRED_SCHEDULES: Record<string, InferredSchedule> = {
  '0011': { workDays: 'SEG,TER,QUA', scheduleStart: '07:59', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '0019': { workDays: 'QUI,SEX', scheduleStart: '07:57', scheduleEnd: '17:02', regime: 'INTEGRAL' },
  '0021': { workDays: 'TER,QUA,QUI', scheduleStart: '07:58', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '0028': { workDays: 'SEG,QUA,SEX', scheduleStart: '07:58', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '0029': { workDays: 'TER,QUA,QUI', scheduleStart: '07:58', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '0040': { workDays: 'SEG,SEX', scheduleStart: '07:58', scheduleEnd: '17:02', regime: 'INTEGRAL' },
  '0042': { workDays: 'QUA,QUI', scheduleStart: '07:57', scheduleEnd: '17:03', regime: 'INTEGRAL' },
  '0043': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '0050': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:57', scheduleEnd: '17:02', regime: 'INTEGRAL' },
  '0304': { workDays: 'TER,QUA,QUI', scheduleStart: '08:01', scheduleEnd: '17:00', regime: 'INTEGRAL' },
  '0506': { workDays: 'TER,QUI,SEX', scheduleStart: '07:26', scheduleEnd: '16:31', regime: 'INTEGRAL' },
  '0701': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '09:30', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '0803': { workDays: 'SEG,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '15:02', regime: 'INTEGRAL' },
  '0909': { workDays: 'TER,QUA,QUI', scheduleStart: '08:01', scheduleEnd: '17:00', regime: 'INTEGRAL' },
  '1404': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:56', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '1508': { workDays: 'SEG,QUI,SEX', scheduleStart: '07:56', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '1701': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:58', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '1705': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:26', scheduleEnd: '11:32', regime: 'MEIO_EXPEDIENTE' },
  '1807': { workDays: 'TER,QUI', scheduleStart: '07:57', scheduleEnd: '17:03', regime: 'INTEGRAL' },
  '1811': { workDays: 'SEG,TER,SEX', scheduleStart: '07:56', scheduleEnd: '17:02', regime: 'INTEGRAL' },
  '1910': { workDays: 'SEG,QUA', scheduleStart: '07:58', scheduleEnd: '17:02', regime: 'INTEGRAL' },
  '2020': { workDays: 'SEG,QUA', scheduleStart: '07:58', scheduleEnd: '17:00', regime: 'INTEGRAL' },
  '2201': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:28', scheduleEnd: '16:32', regime: 'INTEGRAL' },
  '2203': { workDays: 'SEX', scheduleStart: '08:00', scheduleEnd: '17:00', regime: 'INTEGRAL' },
  '2409': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:26', scheduleEnd: '11:32', regime: 'MEIO_EXPEDIENTE' },
  '2506': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '06:58', scheduleEnd: '16:01', regime: 'INTEGRAL' },
  '2611': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:58', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '2904': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:29', scheduleEnd: '16:31', regime: 'INTEGRAL' },
  '3107': { workDays: 'TER', scheduleStart: '11:57', scheduleEnd: '16:04', regime: 'MEIO_EXPEDIENTE' },
  '4041': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:56', scheduleEnd: '17:00', regime: 'INTEGRAL' },
  '5050': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:29', scheduleEnd: '11:31', regime: 'MEIO_EXPEDIENTE' },
  '5100': { workDays: 'SEG,QUA', scheduleStart: '07:55', scheduleEnd: '17:01', regime: 'INTEGRAL' },
  '5500': { workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:57', scheduleEnd: '17:01', regime: 'INTEGRAL' },
};
