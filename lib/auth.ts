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
        password: { label: 'Senha administrativa', type: 'password' },
      },
      async authorize(credentials) {
        const password = credentials?.password;
        if (!password) return null;

        const manager = await prisma.user.findFirst({
          where: { active: true, role: { in: managerRoles } },
          orderBy: { createdAt: 'asc' },
        });
        if (!manager) return null;

        const configuredPassword = process.env.ADMIN_ACCESS_PASSWORD;
        const validPassword = configuredPassword
          ? password === configuredPassword
          : Boolean(manager.passwordHash && await bcrypt.compare(password, manager.passwordHash));

        if (!validPassword) return null;
        return { id: manager.id, name: manager.name, email: manager.email };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = (user as any).id;
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) (session.user as any).id = (token as any).id;
      return session;
    },
  },
  pages: { signIn: '/auth/signin' },
};
