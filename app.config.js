const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
    owner: 'wfj',
    extra: {
      apiUrl:
        process.env.EXPO_PUBLIC_API_URL ||
        'https://friendlyteacher-production.up.railway.app',
      contactForCode: process.env.EXPO_PUBLIC_CONTACT_FOR_CODE || '',
      eas: {
        projectId: '439a9465-4653-4252-945d-cf25eae9cb9e',
      },
    },
  },
};
