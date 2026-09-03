'use client';

import './emp-app.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

// TEMP: full file restored via multi-step — see employee-shell
export { default } from './employee-shell';
