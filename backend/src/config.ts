import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nanit: {
    baseUrl: 'https://api.nanit.com',
    userAgent: 'Nanit/6.0.0 (iOS; iPhone; Scale/2.00)',
    apiVersion: '1',
    platform: 'unknown',
    serviceVersion: '3.52.0 (882)',
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-pro-latest',
  },
};
