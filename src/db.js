import mongoose from 'mongoose';

import { config } from './config.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

export async function connectDb() {
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'mongo connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('mongo disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('mongo reconnected');
  });

  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 10,
  });
  logger.info('mongo connected');
}

export async function disconnectDb() {
  try {
    await mongoose.disconnect();
  } catch (err) {
    logger.error({ err }, 'mongo disconnect error');
  }
}
