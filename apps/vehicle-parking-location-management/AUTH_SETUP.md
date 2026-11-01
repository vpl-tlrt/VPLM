# VPLM account and data setup

## Supabase database

Run `supabase/schema.sql` in the SQL Editor for the Supabase project used by the app. It preserves current workspace members and adds the User ID, name, and mobile fields needed by the new login flow. It also removes direct client write access to shared workspace data; writes now pass through the role-checking `workspace-sync` function.

Existing email-authenticated accounts are preserved. Until their profile is migrated, existing users can temporarily sign in with their current email and password. An Administrator assigns each existing user a unique User ID, mobile number, and role from **Profile → Registered users → Complete setup**. Their existing password remains unchanged. Users can then sign in with their assigned User ID and password.

## Password login and WhatsApp recovery

1. In Supabase Authentication settings, disable public sign-ups. Hiding the sign-up form alone does not disable the public Auth API; the app creates accounts through its Administrator-only Edge Function.
2. Enable phone authentication and configure the project’s Twilio WhatsApp provider, including a verified/approved WhatsApp sender and message template as required by Twilio.
3. Keep mobile numbers in E.164 format, including the leading `+` and country code. WhatsApp recovery only works after the account’s number is valid and the Supabase phone provider can deliver and verify codes.
4. New users are created with the default login password `Park@123`. Share it securely. Users are not forced to change it at first sign-in. They can change it later through the password-recovery flow.

Supabase supports WhatsApp OTP through its Twilio and Twilio Verify providers. Configure the provider in Supabase Authentication; do not put Twilio credentials in the frontend or GitHub variables.

## Deploy Edge Functions

From `apps/vehicle-parking-location-management`, link the Supabase CLI to the correct project and deploy:

```sh
supabase functions deploy admin-users
supabase functions deploy user-auth
supabase functions deploy workspace-sync
supabase functions deploy ai-assistant
```

The functions use Supabase’s built-in project URL and server-side secret/service-role key. Never expose a secret/service-role key to the browser. Enable `phone` sign-in and configure Twilio in the Supabase dashboard before testing WhatsApp recovery.

## Data and roles

Vehicle, parking, movement, reservation, road-test, layout, and audit snapshots continue to sync to `workspace_state` in Supabase. The browser’s local copy is an offline cache; it is not a guest account or a substitute for the cloud copy. The `workspace-sync` function validates membership and role restrictions before persisting changes.

The existing application roles and their current UI rules remain in effect. Road-test records are blocked for Drivers, Guest Users, and Others; management layout and reservations are limited to Administrator/Supervisor roles. Administrator-only user and role management stays in the `admin-users` function.
