import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

// If FIREBASE_SERVICE_ACCOUNT is provided as a string, parse it. Otherwise, use application default credentials.
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      admin.initializeApp();
    }
  } catch (error) {
    console.error('Firebase initialization error', error);
  }
}

export const db = admin.firestore();
