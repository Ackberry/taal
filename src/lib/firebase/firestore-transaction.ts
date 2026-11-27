import "server-only";

import type { Firestore, Transaction } from "firebase-admin/firestore";

export async function runFirestoreWriteTransaction<T>(db: Firestore, update: (transaction: Transaction) => Promise<T>) {
  try {
    return await db.runTransaction(update);
  } catch (error) {
    const invalidArgument = 3;
    if (!process.env.FIRESTORE_EMULATOR_HOST || !(error instanceof Error) || !("code" in error) ||
      error.code !== invalidArgument || !error.message.endsWith("Transaction is invalid or closed.")) {
      throw error;
    }
    // After a lock timeout, the emulator can reject the SDK's retry transaction ID.
    return db.runTransaction(update);
  }
}
