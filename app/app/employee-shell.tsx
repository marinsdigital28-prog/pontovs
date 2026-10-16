'use client';

import './emp-app.css';
import './emp-radar.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

// TEMPORARY STUB - will be replaced
export default function EmployeeAppPage() {
  return <main className="emp-app"><p>Carregando app… recarregue em instantes.</p></main>;
}
