import { PrismaClient, Prisma } from "@prisma/client";
export const db = new PrismaClient();
export { Prisma };
export type Transaction = Prisma.TransactionClient;
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function activityLock(tx: Transaction, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
}
