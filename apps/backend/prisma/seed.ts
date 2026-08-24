import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertBootstrapUser() {
  const usersCount = await prisma.user.count();
  if (usersCount > 0) {
    return;
  }

  const login = process.env.INIT_ADMIN_LOGIN ?? process.env.BOOTSTRAP_USER_LOGIN;
  const password = process.env.INIT_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_USER_PASSWORD;

  if (!login || !password) {
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      login,
      passwordHash,
      isActive: true,
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
}

upsertBootstrapUser()
  .catch((err) => {
    console.error('Seed failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
