import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from './prisma';

const managerRoles = ['ADMIN', 'MANAGER'];

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'AdminPassword',
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        const password = credentials?.password;
        const email = credentials?.email?.trim().toLowerCase();
        if (!password) return null;

        if (email) {
          const employee = await prisma.user.findFirst({ where: { email, active: true, role: 'EMPLOYEE' }, select: { id: true, name: true, email: true, passwordHash: true } });
          if (!employee?.passwordHash || !(await bcrypt.compare(password, employee.passwordHash))) return null;
          return { id: employee.id, name: employee.name, email: employee.email, role: 'EMPLOYEE' };
        }

        const manager = await prisma.user.findFirst({
          where: { active: true, role: { in: managerRoles } },
          orderBy: { createdAt: 'asc' },
        });
        if (!manager) return null;

        const configuredPassword = process.env.ADMIN_ACCESS_PASSWORD || process.env.ADMIN_PASSWORD || process.env.SENHA_DE_ADMINISTRADOR || process.env.SENHA_DE_ACESSO_DE_ADMINISTRADOR;
        const validPassword = configuredPassword
          ? password === configuredPassword
          : Boolean(manager.passwordHash && await bcrypt.compare(password, manager.passwordHash));

        if (!validPassword) return null;
        return { id: manager.id, name: manager.name, email: manager.email, role: String(manager.role) };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.id = (user as any).id; token.role = (user as any).role; }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) { (session.user as any).id = (token as any).id; (session.user as any).role = (token as any).role; }
      return session;
    },
  },
  pages: { signIn: '/auth/signin' },
};
