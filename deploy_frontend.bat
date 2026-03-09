@echo off
SET PROJECT_ID=form-helper-478620-q3
SET REGION=us-central1
SET SERVICE_NAME=formreminder-frontend
SET BACKEND_URL=https://formreminder-backend-176029126556.us-central1.run.app
SET SOURCE_DIR=.\frontend

echo.
echo Writing .env.production with backend URL...
echo VITE_API_URL=%BACKEND_URL%> %SOURCE_DIR%\.env.production
echo Done. Contents:
type %SOURCE_DIR%\.env.production
echo.

call gcloud config set project %PROJECT_ID%

call gcloud run deploy %SERVICE_NAME% ^
  --source %SOURCE_DIR% ^
  --region %REGION% ^
  --allow-unauthenticated

echo.
echo Frontend deployment complete!
echo.
pause