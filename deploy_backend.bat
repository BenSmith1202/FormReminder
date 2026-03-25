@echo off
:: =====================================================================
:: FormReminder - Backend Deployment Script
:: Run this from the ROOT of your project (the FormReminder/ folder)
:: =====================================================================

:: ---- CONFIGURATION - Edit these values ----
SET PROJECT_ID=form-helper-478620-q3
SET REGION=us-central1
SET SERVICE_NAME=formreminder-backend
SET SOURCE_DIR=.\backend
:: -------------------------------------------

echo.
echo ============================================================
echo  Deploying FormReminder Backend to Cloud Run
echo  Project : %PROJECT_ID%
echo  Region  : %REGION%
echo  Service : %SERVICE_NAME%
echo ============================================================
echo.

:: Ensure gcloud is pointing at the right project
call gcloud config set project %PROJECT_ID%

:: =====================================================================
:: SECRETS - These are read from Google Cloud Secret Manager at deploy
:: time and injected as environment variables into the container.
::
:: Before running this script for the FIRST TIME, create your secrets:
::
::   DONE!!!!! vvvvv
::   gcloud secrets create FIREBASE_CREDENTIALS_JSON --data-file=backend\firebase-credentials.json
::   gcloud secrets create GOOGLE_CLIENT_SECRET_JSON  --data-file=backend\client_secret.json
::   gcloud secrets create FLASK_SECRET_KEY           --data-file=- <<< "your-random-secret-key"
::   gcloud secrets create Email_It_API                --data-file=- <<< "your-emailit-api-key"
::   DONE!!!!!! ^^^^

:: DONE!!! I think. vvv
:: Then grant the Cloud Run service account access:
::   gcloud secrets add-iam-policy-binding FIREBASE_CREDENTIALS_JSON \
::     --member=serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com \
::     --role=roles/secretmanager.secretAccessor
::   (Repeat for each secret)
:: =====================================================================

call gcloud run deploy %SERVICE_NAME% ^
  --source %SOURCE_DIR% ^
  --region %REGION% ^
  --allow-unauthenticated ^
  --clear-base-image ^
  --min-instances 1 ^
  --max-instances 30 ^
  --set-secrets="FIREBASE_CREDENTIALS_JSON=FIREBASE_CREDENTIALS_JSON:latest,GOOGLE_CLIENT_SECRET_JSON=GOOGLE_CLIENT_SECRET_JSON:latest,SECRET_KEY=FLASK_SECRET_KEY:latest,EMAILIT_API_KEY=Email_It_API:latest" ^
  --set-env-vars="FIREBASE_PROJECT_ID=form-helper-478620-q3,GOOGLE_CLIENT_ID=176029126556-mmrs8trp6mue4f997j8aqmuu12t2fn5f.apps.googleusercontent.com,GOOGLE_REDIRECT_URI=https://formreminder-backend-176029126556.us-central1.run.app/oauth/callback,BACKEND_PUBLIC_URL=https://formreminder-backend-176029126556.us-central1.run.app,FRONTEND_URL=https://formreminder-frontend-176029126556.us-central1.run.app,DEBUG=False,EMAILIT_FROM_ADDRESS=reminders@mail.formreminder.com,EMAILIT_FROM_NAME=FormReminder"

:: NOTE on --min-instances 1:
:: Your app uses APScheduler for automatic reminders. Cloud Run scales to 0
:: by default, which means the scheduler stops running when there is no traffic.
:: Setting min-instances to 1 keeps one container alive at all times so the
:: scheduler keeps firing. This incurs a small always-on cost.

echo.
echo Backend deployment complete!
echo.
echo IMPORTANT: Copy the Service URL printed above, then:
echo   1. Update GOOGLE_REDIRECT_URI and BACKEND_PUBLIC_URL in this script
echo      with the real URL (replacing the placeholder HASH value).
echo   2. Add the callback URL to your Google Cloud OAuth 2.0 client's
echo      "Authorized redirect URIs" in the Google Cloud Console.
echo   3. Run this script once more to apply the corrected env vars.
echo.
pause
