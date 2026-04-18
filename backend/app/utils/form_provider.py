# Form Provider Abstraction
# Detects which form provider a URL belongs to and dispatches to the
# correct service (Google Forms, Jotform, Microsoft Forms).

import re
from typing import Dict, List, Optional, Tuple

from utils.google_forms_service import GoogleFormsService
from utils.jotform_service import JotformService
from utils.microsoft_forms_service import MicrosoftFormsService

# Provider constants used throughout the app
PROVIDER_GOOGLE = "google"
PROVIDER_JOTFORM = "jotform"
PROVIDER_MICROSOFT = "microsoft"

ALL_PROVIDERS = [PROVIDER_GOOGLE, PROVIDER_JOTFORM, PROVIDER_MICROSOFT]


def detect_provider(form_url: str) -> Optional[str]:
    """Return the provider key for a given form URL, or None if unknown."""
    url = form_url.strip().lower()

    # Google Forms
    if "docs.google.com/forms" in url:
        return PROVIDER_GOOGLE

    # Jotform — numeric-only IDs are also Jotform
    if "jotform.com" in url:
        return PROVIDER_JOTFORM
    if re.match(r"^\d{8,}$", form_url.strip()):
        return PROVIDER_JOTFORM

    # Microsoft Forms
    if "forms.office.com" in url or "forms.microsoft.com" in url:
        return PROVIDER_MICROSOFT

    return None


def extract_form_id(provider: str, form_url: str) -> Optional[str]:
    """Extract the form ID using the appropriate service."""
    if provider == PROVIDER_GOOGLE:
        return GoogleFormsService.extract_form_id(form_url)
    if provider == PROVIDER_JOTFORM:
        return JotformService.extract_form_id(form_url)
    if provider == PROVIDER_MICROSOFT:
        return MicrosoftFormsService.extract_form_id(form_url)
    return None


def get_viewform_url(provider: str, form_url_or_id: str) -> str:
    """Return the public-facing URL for a form."""
    if provider == PROVIDER_GOOGLE:
        return GoogleFormsService.get_viewform_url(form_url_or_id)
    if provider == PROVIDER_JOTFORM:
        return JotformService.get_viewform_url(form_url_or_id)
    if provider == PROVIDER_MICROSOFT:
        return MicrosoftFormsService.get_viewform_url(form_url_or_id)
    return form_url_or_id


def get_form_metadata(provider: str, credentials, form_id: str, **kwargs) -> Dict:
    """Fetch form metadata via the correct service.

    ``credentials`` shape varies by provider:
    - google  → ``google.oauth2.credentials.Credentials``
    - jotform → plain API key string
    - microsoft → access-token string

    Extra keyword arguments are forwarded to providers that need them
    (currently Microsoft — ``form_title``, ``excel_file_id``).
    """
    if provider == PROVIDER_GOOGLE:
        return GoogleFormsService.get_form_metadata(credentials, form_id)
    if provider == PROVIDER_JOTFORM:
        return JotformService.get_form_metadata(credentials, form_id)
    if provider == PROVIDER_MICROSOFT:
        return MicrosoftFormsService.get_form_metadata(credentials, form_id, **kwargs)
    raise ValueError(f"Unknown provider: {provider}")


def get_form_responses(provider: str, credentials, form_id: str, **kwargs) -> List[Dict]:
    """Fetch form responses via the correct service.

    Extra keyword arguments are forwarded to providers that need them
    (currently Microsoft — ``excel_file_id``, ``form_title``).
    """
    if provider == PROVIDER_GOOGLE:
        return GoogleFormsService.get_form_responses(credentials, form_id)
    if provider == PROVIDER_JOTFORM:
        return JotformService.get_form_responses(credentials, form_id)
    if provider == PROVIDER_MICROSOFT:
        return MicrosoftFormsService.get_form_responses(credentials, form_id, **kwargs)
    raise ValueError(f"Unknown provider: {provider}")


def get_credentials_for_provider(user, provider: str):
    """Return the credential object needed by the provider's service.

    Raises ``ValueError`` if the user has not connected the requested provider.
    Returns:
    - google   → ``Credentials`` object (via ``GoogleFormsService``)
    - jotform  → API key string
    - microsoft → access-token string (after auto-refresh)
    """
    if provider == PROVIDER_GOOGLE:
        if not user.google_access_token:
            raise ValueError("Google Forms account not connected")
        creds = GoogleFormsService.get_credentials_from_tokens(
            user.google_access_token,
            user.google_refresh_token,
            user.token_expiry or "",
        )
        # Persist refreshed token back so we don't re-refresh every request
        if creds.token != user.google_access_token:
            new_expiry = creds.expiry.isoformat() + 'Z' if creds.expiry else ""
            user.update_google_tokens(creds.token, creds.refresh_token, new_expiry)
        return creds

    if provider == PROVIDER_JOTFORM:
        api_key = JotformService._get_api_key(user)
        if not api_key:
            raise ValueError("Jotform account not connected")
        return api_key

    if provider == PROVIDER_MICROSOFT:
        if not user.microsoft_access_token:
            raise ValueError("Microsoft Forms account not connected")
        access, refresh, expiry = MicrosoftFormsService._ensure_valid_token(
            user.microsoft_access_token,
            user.microsoft_refresh_token or "",
            user.microsoft_token_expiry or "",
        )
        # Persist refreshed tokens back to the user doc if they changed
        if access != user.microsoft_access_token:
            user.update_microsoft_tokens(access, refresh, expiry)
        return access

    raise ValueError(f"Unknown provider: {provider}")


def get_connected_providers(user) -> Dict[str, bool]:
    """Return a dict indicating which providers the user has connected."""
    return {
        PROVIDER_GOOGLE: bool(getattr(user, "google_access_token", None)),
        PROVIDER_JOTFORM: bool(getattr(user, "jotform_api_key", None)),
        PROVIDER_MICROSOFT: bool(getattr(user, "microsoft_access_token", None)),
    }
