# Jotform API Service
# Handles form metadata retrieval and submission fetching via Jotform REST API.

import os
import re
from typing import Any, Dict, List, Optional

import requests
from config import settings

JOTFORM_API_BASE = "https://api.jotform.com"


class JotformService:
    """Service for interacting with the Jotform REST API."""

    # ------------------------------------------------------------------
    # URL / ID helpers
    # ------------------------------------------------------------------

    @staticmethod
    def extract_form_id(raw_input: str) -> Optional[str]:
        """Extract a Jotform form ID from a URL or direct numeric ID.

        Accepted formats:
        - ``242630266486159`` (plain numeric ID)
        - ``https://form.jotform.com/242630266486159``
        - ``https://www.jotform.com/form/242630266486159``
        """
        candidate = raw_input.strip()
        if not candidate:
            return None

        if candidate.isdigit():
            return candidate

        id_match = re.search(r"(?:/form/|/)(\d{8,})", candidate)
        if id_match:
            return id_match.group(1)

        return None

    @staticmethod
    def get_viewform_url(form_url_or_id: str) -> str:
        """Return the public-facing Jotform URL for recipients."""
        form_id = JotformService.extract_form_id(form_url_or_id)
        if form_id:
            return f"https://form.jotform.com/{form_id}"
        return form_url_or_id

    # ------------------------------------------------------------------
    # API helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_api_key(user=None) -> str:
        """Return the API key to use for requests.

        Prefers the per-user key stored on the User document.  Falls back to
        the master key in the environment / settings.
        """
        if user and getattr(user, "jotform_api_key", None):
            return user.jotform_api_key
        return settings.JOTFORM_API_KEY or os.environ.get("JOTFORM_API_KEY", "")

    @staticmethod
    def _api_get(endpoint: str, api_key: str, params: dict | None = None) -> Any:
        """Perform a GET against the Jotform API and return parsed JSON content."""
        url = f"{JOTFORM_API_BASE}{endpoint}"
        all_params = {"apiKey": api_key}
        if params:
            all_params.update(params)
        resp = requests.get(url, params=all_params, timeout=20)
        resp.raise_for_status()
        payload = resp.json()
        return payload.get("content", payload)

    # ------------------------------------------------------------------
    # Public interface (mirrors GoogleFormsService shape)
    # ------------------------------------------------------------------

    @staticmethod
    def get_form_metadata(api_key: str, form_id: str) -> Dict:
        """Fetch form metadata (title, etc.) from Jotform."""
        try:
            print(f"[Jotform] Fetching metadata for form {form_id}")
            data = JotformService._api_get(f"/form/{form_id}", api_key)

            title = data.get("title", "Untitled Jotform")

            # Jotform always returns the submitter email if the form has an
            # email field, so we optimistically mark collection as enabled.
            return {
                "title": title,
                "description": "",
                "email_collection_enabled": True,
                "email_collection_type": "JOTFORM_FIELD",
            }
        except Exception as e:
            print(f"[Jotform] Error fetching metadata: {e}")
            raise

    @staticmethod
    def get_form_responses(api_key: str, form_id: str) -> List[Dict]:
        """Fetch all submissions for a Jotform form.

        Returns a list of dicts matching the shape used by the rest of the app:
        ``{respondent_email, response_id, create_time, answers}``.
        """
        try:
            print(f"[Jotform] Fetching responses for form {form_id}")
            submissions = JotformService._api_get(
                f"/form/{form_id}/submissions", api_key
            )
            if not isinstance(submissions, list):
                return []

            processed: List[Dict] = []
            for sub in submissions:
                if not isinstance(sub, dict):
                    continue
                answers = sub.get("answers", {})
                email = JotformService._extract_email(answers)
                parsed = JotformService._parse_answers(answers)

                processed.append({
                    "respondent_email": email or "",
                    "response_id": str(sub.get("id", "")),
                    "create_time": sub.get("created_at", ""),
                    "answers": parsed,
                })

            print(f"[Jotform] Found {len(processed)} submissions")
            return processed
        except Exception as e:
            print(f"[Jotform] Error fetching responses: {e}")
            raise

    # ------------------------------------------------------------------
    # Email collection check — Jotform forms always collect by field
    # ------------------------------------------------------------------

    @staticmethod
    def check_email_collection(api_key: str, form_id: str) -> bool:
        """Return True if the form has an email-type question."""
        try:
            questions = JotformService._api_get(
                f"/form/{form_id}/questions", api_key
            )
            if isinstance(questions, dict):
                for q in questions.values():
                    if isinstance(q, dict) and q.get("type") == "control_email":
                        return True
            return False
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_email(answers: Any) -> Optional[str]:
        """Extract the first email from a Jotform answers dict."""
        if not isinstance(answers, dict):
            return None

        # First pass: look for explicit email field type
        for qdata in answers.values():
            if not isinstance(qdata, dict):
                continue
            if qdata.get("type") == "control_email":
                answer = qdata.get("answer") or qdata.get("prettyFormat")
                if answer:
                    return str(answer).strip()

        # Second pass: regex scan
        pattern = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
        for qdata in answers.values():
            if not isinstance(qdata, dict):
                continue
            val = qdata.get("answer") or qdata.get("prettyFormat") or ""
            if isinstance(val, str):
                m = pattern.search(val)
                if m:
                    return m.group(0)
        return None

    @staticmethod
    def _parse_answers(answers: Any) -> Dict[str, Any]:
        """Normalise Jotform answers into ``{label: value}`` pairs."""
        parsed: Dict[str, Any] = {}
        if not isinstance(answers, dict):
            return parsed
        for qdata in answers.values():
            if not isinstance(qdata, dict):
                continue
            label = (
                qdata.get("text")
                or qdata.get("name")
                or qdata.get("qid")
                or "Unknown"
            )
            if "prettyFormat" in qdata and qdata["prettyFormat"] not in (None, ""):
                parsed[str(label)] = qdata["prettyFormat"]
            elif "answer" in qdata:
                parsed[str(label)] = qdata["answer"]
        return parsed
