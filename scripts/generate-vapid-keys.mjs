#!/usr/bin/env node

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('VAPID Keys Generated\n');
console.log('Add these to your .env file:\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
