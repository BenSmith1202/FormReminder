# Microsoft Forms Service
# Handles OAuth flow, token management, and Microsoft Forms API interactions
# via Azure AD (server-side, Files.Read.All scope).

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import msal
import requests
from config import settings

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
FORMS_API_BASE = "https://forms.office.com/formapi/api/v1.0"


class MicrosoftFormsService:
    """Service for interacting with Microsoft Forms via Graph / Forms API."""

    SCOPES = ["User.Read", "Files.Read.All"]

    # ------------------------------------------------------------------
    # MSAL / OAuth helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_msal_app() -> msal.ConfidentialClientApplication:
        return msal.ConfidentialClientApplication(
            client_id=settings.MICROSOFT_CLIENT_ID,
            client_credential=settings.MICROSOFT_CLIENT_SECRET,
            authority=settings.MICROSOFT_AUTHORITY,
        )

    @staticmethod
    def get_authorization_url(state: str, redirect_uri: str) -> str:
        """Return the Azure AD authorization URL (redirect the user here)."""
        app = MicrosoftFormsService._get_msal_app()
        result = app.get_authorization_request_url(
            scopes=MicrosoftFormsService.SCOPES,
            state=state,
            redirect_uri=redirect_uri,
        )
        return result

    @staticmethod
    def exchange_code_for_tokens(code: str, redirect_uri: str) -> Dict:
        """Exchange the authorisation code for access / refresh tokens."""
        app = MicrosoftFormsService._get_msal_app()
        result = app.acquire_token_by_authorization_code(
            code,
            scopes=MicrosoftFormsService.SCOPES,
            redirect_uri=redirect_uri,
        )
        if "error" in result:
            raise RuntimeError(
                f"Microsoft token exchange failed: {result.get('error_description', result.get('error'))}"
            )

        expires_in = result.get("expires_in", 3600)
        expiry = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

        return {
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token", ""),
            "token_expiry": expiry.isoformat(),
        }

    @staticmethod
    def refresh_access_token(refresh_token: str) -> Dict:
        """Use a refresh token to obtain a new access token."""
        app = MicrosoftFormsService._get_msal_app()
        result = app.acquire_token_by_refresh_token(
            refresh_token, scopes=MicrosoftFormsService.SCOPES
        )
        if "error" in result:
            raise RuntimeError(
                f"Microsoft token refresh failed: {result.get('error_description', result.get('error'))}"
            )

        expires_in = result.get("expires_in", 3600)
        expiry = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

        return {
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token", refresh_token),
            "token_expiry": expiry.isoformat(),
        }

    @staticmethod
    def _ensure_valid_token(access_token: str, refresh_token: str, token_expiry: str):
        """Return a valid (access_token, refresh_token, expiry) tuple.

        Refreshes the token automatically if it is expired or about to expire.
        """
        try:
            expiry_str = token_expiry.replace("Z", "+00:00") if token_expiry else ""
            expiry_dt = datetime.fromisoformat(expiry_str) if expiry_str else datetime.min.replace(tzinfo=timezone.utc)
        except Exception:
            expiry_dt = datetime.min.replace(tzinfo=timezone.utc)

        # Refresh if expiring within 5 minutes
        if expiry_dt - datetime.now(timezone.utc) < timedelta(minutes=5):
            if not refresh_token:
                raise ValueError("Microsoft token expired and no refresh token available")
            refreshed = MicrosoftFormsService.refresh_access_token(refresh_token)
            return (
                refreshed["access_token"],
                refreshed["refresh_token"],
                refreshed["token_expiry"],
            )
        return access_token, refresh_token, token_expiry

    # ------------------------------------------------------------------
    # Graph API helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _graph_get(endpoint: str, access_token: str, params: dict | None = None) -> Any:
        headers = {"Authorization": f"Bearer {access_token}"}
        resp = requests.get(
            f"{GRAPH_API_BASE}{endpoint}", headers=headers, params=params, timeout=20
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _forms_get(endpoint: str, access_token: str) -> Any:
        headers = {"Authorization": f"Bearer {access_token}"}
        resp = requests.get(
            f"{FORMS_API_BASE}{endpoint}", headers=headers, timeout=20
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # URL / ID helpers
    # ------------------------------------------------------------------

    @staticmethod
    def extract_form_id(raw_input: str) -> Optional[str]:
        """Extract a Microsoft Forms form ID from a URL or plain ID.

        Accepted formats:
        - ``https://forms.office.com/Pages/ResponsePage.aspx?id=FORM_ID``
        - ``https://forms.office.com/r/SHORT_CODE``
        - raw GUID-like string
        """
        candidate = raw_input.strip()
        if not candidate:
            return None

        # /r/ short-link
        m = re.search(r"forms\.office\.com/r/([A-Za-z0-9]+)", candidate)
        if m:
            return m.group(1)

        # ?id= query-param
        m = re.search(r"[?&]id=([^&]+)", candidate)
        if m:
            return m.group(1)

        # Plain GUID or ID
        if re.match(r"^[A-Za-z0-9_-]{10,}$", candidate):
            return candidate

        return None

    @staticmethod
    def get_viewform_url(form_url_or_id: str) -> str:
        """Return the public-facing Microsoft Forms URL."""
        form_id = MicrosoftFormsService.extract_form_id(form_url_or_id)
        if form_id:
            return f"https://forms.office.com/r/{form_id}"
        return form_url_or_id

    # ------------------------------------------------------------------
    # Public interface (mirrors GoogleFormsService shape)
    # ------------------------------------------------------------------

    @staticmethod
    def get_user_id(access_token: str) -> str:
        """Fetch the signed-in user's Microsoft ID."""
        data = MicrosoftFormsService._graph_get("/me", access_token)
        return data["id"]

    @staticmethod
    def get_form_metadata(access_token: str, form_id: str) -> Dict:
        """Fetch form metadata from Microsoft Forms API."""
        try:
            print(f"[Microsoft] Fetching metadata for form {form_id}")
            user_id = MicrosoftFormsService.get_user_id(access_token)
            data = MicrosoftFormsService._forms_get(
                f"/users/{user_id}/forms('{form_id}')", access_token
            )

            title = data.get("title", "Untitled Microsoft Form")

            return {
                "title": title,
                "description": data.get("description", ""),
                "email_collection_enabled": True,
                "email_collection_type": "MICROSOFT_IDENTITY",
            }
        except Exception as e:
            print(f"[Microsoft] Error fetching metadata: {e}")
            raise

    @staticmethod
    def get_form_responses(access_token: str, form_id: str) -> List[Dict]:
        """Fetch all responses for a Microsoft Form.

        Returns a list of dicts matching the common shape:
        ``{respondent_email, response_id, create_time, answers}``.
        """
        try:
            print(f"[Microsoft] Fetching responses for form {form_id}")
            user_id = MicrosoftFormsService.get_user_id(access_token)
            data = MicrosoftFormsService._forms_get(
                f"/users/{user_id}/forms('{form_id}')/responses", access_token
            )

            raw_responses = data.get("value", [])
            processed: List[Dict] = []
            for r in raw_responses:
                if not isinstance(r, dict):
                    continue
                email = r.get("responder", {}).get("email", "") if isinstance(r.get("responder"), dict) else ""
                answers = {}
                for a in r.get("answers", []):
                    qid = a.get("questionId", "")
                    answers[qid] = a.get("value", "")

                processed.append({
                    "respondent_email": email,
                    "response_id": r.get("id", ""),
                    "create_time": r.get("submitDate", ""),
                    "answers": answers,
                })

            print(f"[Microsoft] Found {len(processed)} responses")
            return processed
        except Exception as e:
            print(f"[Microsoft] Error fetching responses: {e}")
            raise
