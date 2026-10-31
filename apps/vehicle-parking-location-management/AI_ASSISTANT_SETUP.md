# VPLM AI Assistant (prototype)

The assistant is a Gemini-powered chat panel served by a Supabase Edge Function. It is intentionally a **prototype**: it does not query vehicle tables or execute parking/road-test actions. The model must not claim otherwise.

## Deploy

1. Create an API key in Google AI Studio: https://aistudio.google.com/apikey
2. From the Supabase project linked to this app, open Edge Function secrets and set `GEMINI_API_KEY`. Optionally set `GEMINI_MODEL` to a model available to your API key. Never put the Gemini key in a `VITE_*` variable or in the GitHub repository.
3. Deploy the function from `apps/vehicle-parking-location-management`:
   ```sh
   supabase functions deploy ai-assistant
   ```
   The function uses the project's standard `SUPABASE_URL` and publishable/anon key environment values, and validates the caller's Supabase access token.
4. Publish the frontend through the existing GitHub Pages workflow.

## Important free-tier privacy note

Use only synthetic, non-sensitive prompts while using Gemini's unpaid API quota. Google's terms say data submitted to unpaid services may be used to improve Google products and may be reviewed by people. Do not send live registrations, VINs, customer details, personal information, or confidential operational data. Review the current provider terms and quota limits before broader use.

## Current limits

- Requires a signed-in Supabase user; local guest mode is not supported.
- Each message is sent as a standalone request; chat history is not sent to the model.
- No live database context, tools, workflow execution, or write access is enabled.
- Gemini free-tier quotas can change and may return rate-limit errors.
