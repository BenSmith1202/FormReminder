# Microsoft Forms Service
# Handles OAuth flow, token management, and reading Microsoft Forms responses
# via Azure AD + OneDrive Excel files (Files.Read.All scope).
#
# Microsoft Forms stores response data in Excel workbooks in the user's
# OneDrive.  We search for those workbooks and read them through the Graph
# API workbook/Excel endpoints — the undocumented Forms REST API is NOT used.

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import msal
import requests
from config import settings

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"


class MicrosoftFormsService:
    """Service for interacting with Microsoft Forms via OneDrive Excel files."""

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
            f"{GRAPH_API_BASE}{endpoint}", headers=headers, params=params, timeout=30
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

    # ------------------------------------------------------------------
    # OneDrive / Excel helpers
    # ------------------------------------------------------------------

    @staticmethod
    def find_response_excel(access_token: str, form_title: str) -> Optional[Dict]:
        """Search OneDrive for the Excel workbook that Microsoft Forms creates
        when collecting responses for a form with the given *form_title*.

        Returns ``{"id": "<driveItemId>", "name": "...", "webUrl": "..."}``
        or ``None`` if nothing matching is found.
        """
        print(f"[Microsoft] Searching OneDrive for Excel file matching '{form_title}'...")

        # Microsoft Forms stores response workbooks in the user's OneDrive.
        # The file is typically named like the form's title in Microsoft Forms
        # (which may differ from the title the user entered in our app).
        # We do two passes:
        #   1. Search by the user-supplied title
        #   2. Broad fallback: search for all .xlsx files

        all_items: List[Dict] = []
        seen_ids: set = set()

        # Pass 1: targeted title search
        if form_title:
            safe_query = form_title.replace("'", "''")
            try:
                results = MicrosoftFormsService._graph_get(
                    f"/me/drive/search(q='{safe_query}')",
                    access_token,
                    params={"$select": "name,id,webUrl,file", "$top": "50"},
                )
                for item in results.get("value", []):
                    iid = item.get("id", "")
                    if iid not in seen_ids:
                        all_items.append(item)
                        seen_ids.add(iid)
            except Exception as e:
                print(f"[Microsoft] OneDrive title search failed: {e}")

        # Pass 2: broad .xlsx search (catches cases where the form title
        # in Microsoft Forms doesn't match the user-supplied title in our app)
        try:
            results = MicrosoftFormsService._graph_get(
                "/me/drive/search(q='.xlsx')",
                access_token,
                params={"$select": "name,id,webUrl,file", "$top": "100"},
            )
            for item in results.get("value", []):
                iid = item.get("id", "")
                if iid not in seen_ids:
                    all_items.append(item)
                    seen_ids.add(iid)
        except Exception as e:
            print(f"[Microsoft] OneDrive broad search failed: {e}")

        if not all_items:
            print(f"[Microsoft] ❌ No Excel files found in OneDrive at all")
            return None

        title_lower = (form_title or "").strip().lower()

        # Score candidates: prefer title matches that are .xlsx
        best: Optional[Dict] = None
        best_score = -1
        for item in all_items:
            name: str = item.get("name", "")
            if not name.lower().endswith(".xlsx"):
                continue
            name_lower = name.lower()
            # Strip .xlsx for comparison
            name_stem = name_lower.rsplit(".xlsx", 1)[0].strip()
            score = 0
            if title_lower and title_lower in name_lower:
                score += 10
            if title_lower and name_stem.startswith(title_lower):
                score += 5
            # Bonus for typical Forms response patterns like "FormTitle(1-123).xlsx"
            if re.search(r"\(\d", name_lower):
                score += 3
            # Small bonus for any xlsx (ensures we still pick something)
            score += 1
            if score > best_score:
                best_score = score
                best = {"id": item["id"], "name": name, "webUrl": item.get("webUrl", "")}

        if best:
            print(f"[Microsoft] ✅ Found Excel file: {best['name']}  (id={best['id'][:20]}…, score={best_score})")
        else:
            print(f"[Microsoft] ❌ No matching Excel file found for '{form_title}'")
        return best

    @staticmethod
    def _read_excel_responses(access_token: str, file_id: str) -> List[Dict]:
        """Read rows from an Excel workbook in OneDrive via the Graph
        workbook API and return normalised response dicts.

        The first row is treated as column headers.  We look for columns
        named ``Email``, ``ID``, ``Completion time``, etc.  If no explicit
        email column is found, we scan every cell in each row for an
        email-like value.
        """
        print(f"[Microsoft] Reading Excel workbook {file_id[:20]}…")

        # 1. List worksheets and pick the first one
        ws_data = MicrosoftFormsService._graph_get(
            f"/me/drive/items/{file_id}/workbook/worksheets",
            access_token,
        )
        sheets = ws_data.get("value", [])
        if not sheets:
            print("[Microsoft] Workbook has no worksheets")
            return []

        sheet_name = sheets[0].get("name", "Sheet1")
        safe_sheet = quote(sheet_name, safe="")

        # 2. Read the usedRange to get all data
        range_data = MicrosoftFormsService._graph_get(
            f"/me/drive/items/{file_id}/workbook/worksheets('{safe_sheet}')/usedRange",
            access_token,
            params={"$select": "text,values"},
        )

        # Prefer 'text' (formatted strings); fall back to 'values' (raw)
        rows = range_data.get("text") or range_data.get("values") or []
        if len(rows) < 2:
            print("[Microsoft] Workbook has no response rows (only headers or empty)")
            return []

        headers_raw = rows[0]
        headers = [str(h).strip().lower() for h in headers_raw]

        # 3. Identify well-known columns
        email_col: Optional[int] = None
        id_col: Optional[int] = None
        time_col: Optional[int] = None
        start_col: Optional[int] = None

        EMAIL_NAMES = {"email", "email address", "respondent email", "e-mail",
                       "your email", "your email address"}
        ID_NAMES = {"id", "response id"}
        TIME_NAMES = {"completion time", "submit date", "completed"}
        START_NAMES = {"start time", "started"}
        SYSTEM_COLS = EMAIL_NAMES | ID_NAMES | TIME_NAMES | START_NAMES

        # Always identify non-email system columns by header first
        for i, h in enumerate(headers):
            if h in ID_NAMES:
                id_col = i
            elif h in TIME_NAMES:
                time_col = i
            elif h in START_NAMES:
                start_col = i

        # Primary: scan ALL data rows for a column that actually contains email-shaped values
        _email_re = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
        if len(rows) > 1:
            col_email_hits = {}
            for row in rows[1:]:
                for i, cell in enumerate(row):
                    if _email_re.match(str(cell).strip()):
                        col_email_hits[i] = col_email_hits.get(i, 0) + 1
            if col_email_hits:
                email_col = max(col_email_hits, key=col_email_hits.get)
                print(f"[Microsoft] Regex-matched email column: col {email_col} ('{headers_raw[email_col]}', {col_email_hits[email_col]} hits)")

        # Fallback: header-name matching if no data-based match found
        if email_col is None:
            for i, h in enumerate(headers):
                if h in EMAIL_NAMES or ("email" in h and h not in SYSTEM_COLS):
                    email_col = i
                    print(f"[Microsoft] Header-matched email column: '{headers_raw[i]}' (col {i})")
                    break

        if email_col is None:
            print(f"[Microsoft] ⚠️  No email column found — respondents will not be identified")

        print(f"[Microsoft] Sheet '{sheet_name}': {len(rows)-1} data rows, "
              f"email_col={email_col}, id_col={id_col}, time_col={time_col}")

        # 4. Parse each data row
        processed: List[Dict] = []
        for row_idx, row in enumerate(rows[1:], start=2):
            # Skip completely empty rows
            if not any(str(cell).strip() for cell in row):
                continue

            def _cell(col_idx: Optional[int]) -> str:
                if col_idx is None or col_idx >= len(row):
                    return ""
                return str(row[col_idx]).strip()

            email = _cell(email_col)
            if email.lower() == "anonymous":
                email = ""
            response_id = _cell(id_col) or str(row_idx)
            submit_time = _cell(time_col)

            # Build answers from non-system columns
            answers: Dict[str, Any] = {}
            for i, h in enumerate(headers):
                if h not in SYSTEM_COLS and i < len(row):
                    label = str(headers_raw[i]).strip()
                    val = str(row[i]).strip() if row[i] else ""
                    if label:
                        answers[label] = val

            processed.append({
                "respondent_email": email,
                "response_id": response_id,
                "submitted_at": submit_time,
                "answers": answers,
                "answer_count": len(answers),
                "_no_email_column": email_col is None,
            })

        print(f"[Microsoft] Parsed {len(processed)} responses from Excel")
        return processed

    # ------------------------------------------------------------------
    # Standard provider interface
    # ------------------------------------------------------------------

    @staticmethod
    def get_form_metadata(access_token: str, form_id: str, **kwargs) -> Dict:
        """Return metadata for a Microsoft Form.

        Because there is no reliable public Forms API we return sensible
        defaults.  The real title is provided by the user at create-time and
        passed through ``kwargs['form_title']`` when available.

        If *excel_file_id* is supplied we confirm the file exists, giving
        early feedback.
        """
        form_title = kwargs.get("form_title", "")
        excel_file_id = kwargs.get("excel_file_id")

        # Optionally validate the Excel file is still reachable
        if excel_file_id:
            try:
                MicrosoftFormsService._graph_get(
                    f"/me/drive/items/{excel_file_id}",
                    access_token,
                    params={"$select": "name,id"},
                )
                print(f"[Microsoft] Excel file {excel_file_id[:20]}… still accessible ✅")
            except Exception as e:
                print(f"[Microsoft] Warning — could not verify Excel file: {e}")

        # If we don't have a file yet, try to find one
        if not excel_file_id and form_title:
            found = MicrosoftFormsService.find_response_excel(access_token, form_title)
            if found:
                excel_file_id = found["id"]

        return {
            "title": form_title or "Untitled Microsoft Form",
            "description": "",
            "email_collection_enabled": True,
            "email_collection_type": "MICROSOFT_IDENTITY",
            "excel_file_id": excel_file_id,
        }

    @staticmethod
    def get_form_responses(access_token: str, form_id: str, **kwargs) -> List[Dict]:
        """Fetch all responses for a Microsoft Form by reading the associated
        Excel workbook in OneDrive.

        Accepts optional keyword arguments:
        - ``excel_file_id``: Drive-item ID of the known Excel file.
        - ``form_title``: Form title used to *search* OneDrive when the file
          ID is unknown.

        Returns a list of dicts matching the common shape:
        ``{respondent_email, response_id, submitted_at, answers}``.
        """
        excel_file_id = kwargs.get("excel_file_id")
        form_title = kwargs.get("form_title", "")

        # If no file ID stored, try to find it by title
        if not excel_file_id:
            print(f"[Microsoft] No excel_file_id — searching by title '{form_title}'…")
            found = MicrosoftFormsService.find_response_excel(access_token, form_title)
            if not found:
                raise ValueError(
                    f"Could not find the response Excel file for '{form_title}' in OneDrive. "
                    "In Microsoft Forms, open the form → Responses tab → 'Open in Excel' "
                    "to create the response file, then try again."
                )
            excel_file_id = found["id"]
            # The caller should persist this for next time (see _extra_context)

        try:
            responses = MicrosoftFormsService._read_excel_responses(
                access_token, excel_file_id
            )
        except Exception as e:
            print(f"[Microsoft] Error reading Excel: {e}")
            raise

        # Attach the file ID so the caller can persist it
        for r in responses:
            r["_excel_file_id"] = excel_file_id

        return responses
