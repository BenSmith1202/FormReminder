/**
 * @file CreateRequest.tsx
 * @description Provides a comprehensive multi-section form to create a new Form Request.
 * Allows users to link a Google Form, assign it to a recipient group, set a deadline, 
 * and configure automated reminder schedules (preset or custom).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Radio,
  RadioGroup,
  FormControlLabel,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Divider,
  Container,
  Switch,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DescriptionIcon from '@mui/icons-material/Description';
import GroupIcon from '@mui/icons-material/Group';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LinkIcon from '@mui/icons-material/Link';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';
import ErrorSnackbar from '../components/ErrorSnackbar';
import { isValidDate, sanitizePickerDate } from '../utils/dateValidation';

interface Group {
  id: string;
  name: string;
  member_count: number;
}

/**
 * Shared UI Component: SectionHeader
 * Renders a consistent title block with an icon for the different panels in the form.
 * * @param {React.ReactNode} icon - The MUI icon to display.
 * @param {string} title - The main heading for the section.
 * @param {string} [description] - Optional subtext explaining the section.
 * @param {string} [iconBg] - Background color for the icon box (defaults to primary light).
 * @param {string} [iconColor] - Color for the icon itself (defaults to primary main).
 */
function SectionHeader({
  icon,
  title,
  description,
  iconBg = 'primary.50',
  iconColor = 'primary.main',
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  iconBg?: string;
  iconColor?: string;
}) {
  return (
    <>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            bgcolor: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="subtitle1" fontWeight="bold">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
      </Box>
      <Divider sx={{ mb: 3 }} />
    </>
  );
}

/** sessionStorage key for persisting the form draft across navigation */
const DRAFT_KEY = 'fr_create_request_draft';

export default function CreateRequest() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // --- Core Form State ---
  const [provider, setProvider] = useState('google'); // 'google', 'jotform', 'microsoft'
  const [requestTitle, setRequestTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [startActive, setStartActive] = useState(true);

  // --- Automated Schedule State ---
  const [reminderSchedule, setReminderSchedule] = useState('normal'); // 'gentle', 'normal', 'frequent', or 'custom'
  const [firstReminderTiming, setFirstReminderTiming] = useState('immediate'); // 'immediate' or 'scheduled'
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState<Date | null>(null);

  // --- Custom Schedule Configuration State ---
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>([]); // Array of integers (days before deadline)
  const [newDayInput, setNewDayInput] = useState('');
  const [customScheduleError, setCustomScheduleError] = useState<string | null>(null);

  // --- Global UI State ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGoogleReconnect, setNeedsGoogleReconnect] = useState(false);

  // --- Connected providers gating ---
  const [connectedProviders, setConnectedProviders] = useState<{ google: boolean; jotform: boolean; microsoft: boolean }>({
    google: false, jotform: false, microsoft: false,
  });
  const [connectDialogProvider, setConnectDialogProvider] = useState<string | null>(null);
  const [jotformApiKey, setJotformApiKey] = useState('');
  const [jotformError, setJotformError] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);

  // --- Flag to prevent the save-effect from firing while we're still restoring ---
  const [draftRestored, setDraftRestored] = useState(false);

  // Load available recipient groups when the component mounts
  useEffect(() => {
    loadGroups();
  }, []);

  // Fetch connected provider status on mount
  const fetchConnectedProviders = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/connected-accounts`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConnectedProviders({ google: data.google, jotform: data.jotform, microsoft: data.microsoft });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchConnectedProviders(); }, [fetchConnectedProviders]);

  // Re-check when window regains focus (covers OAuth popup flows)
  useEffect(() => {
    const onFocus = () => { fetchConnectedProviders(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchConnectedProviders]);

  /**
   * Restore form draft from sessionStorage on mount.
   * Also handles the ?newGroupId query param that comes back from
   * the "New Group" round-trip so the freshly created group is
   * auto-selected in the dropdown.
   */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.provider) setProvider(draft.provider);
        if (draft.requestTitle) setRequestTitle(draft.requestTitle);
        if (draft.formUrl) setFormUrl(draft.formUrl);
        if (draft.groupId) setGroupId(draft.groupId);
        if (draft.dueDate) setDueDate(sanitizePickerDate(new Date(draft.dueDate as string)));
        if (draft.reminderSchedule) setReminderSchedule(draft.reminderSchedule);
        if (draft.firstReminderTiming) setFirstReminderTiming(draft.firstReminderTiming);
        if (draft.scheduledDate) setScheduledDate(sanitizePickerDate(new Date(draft.scheduledDate as string)));
        if (draft.scheduledTime) setScheduledTime(sanitizePickerDate(new Date(draft.scheduledTime as string)));
        if (draft.customDays) setCustomDays(draft.customDays);
      }
    } catch {
      // Ignore corrupted draft data
    }

    // If we arrived here with ?newGroupId=<id>, auto-select that group
    const newGroupId = searchParams.get('newGroupId');
    if (newGroupId) {
      setGroupId(newGroupId);
      // Clean the query param from the URL without a navigation
      searchParams.delete('newGroupId');
      setSearchParams(searchParams, { replace: true });
    }

    // Allow the save-effect to start persisting
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Persist form fields to sessionStorage on every change so the user
   * doesn't lose progress when navigating away and coming back.
   * Only runs after the initial draft has been restored.
   */
  const saveDraft = useCallback(() => {
    if (!draftRestored) return;
    const draft: Record<string, unknown> = {
      provider,
      requestTitle,
      formUrl,
      groupId,
      dueDate: isValidDate(dueDate) ? dueDate.toISOString() : null,
      reminderSchedule,
      firstReminderTiming,
      scheduledDate: isValidDate(scheduledDate) ? scheduledDate.toISOString() : null,
      scheduledTime: isValidDate(scheduledTime) ? scheduledTime.toISOString() : null,
      customDays,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [
    draftRestored, provider, requestTitle, formUrl, groupId, dueDate,
    reminderSchedule, firstReminderTiming, scheduledDate, scheduledTime, customDays,
  ]);

  useEffect(() => { saveDraft(); }, [saveDraft]);

  /** Clear the draft from sessionStorage (called on submit / cancel). */
  const clearDraft = () => sessionStorage.removeItem(DRAFT_KEY);

  /**
   * Fetches the user's available recipient groups from the backend
   * to populate the "Recipients" dropdown menu.
   */
  const loadGroups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/groups`, { credentials: 'include' });
      const data = await response.json();
      setGroups(data.groups || []);
    } catch {
      console.error('Failed to load groups');
    }
  };

  // ── Provider connect helpers (inline dialog) ──

  /** Called when user selects a provider; gates on connection status. */
  const handleProviderChange = (value: string) => {
    if (connectedProviders[value as keyof typeof connectedProviders]) {
      setProvider(value);
      setFormUrl('');
    } else {
      // Open the connect dialog instead of changing the provider
      setConnectDialogProvider(value);
    }
  };

  const connectOAuthProvider = async (key: string) => {
    setConnectLoading(true);
    try {
      const endpoint = key === 'google' ? '/login/google' : '/login/microsoft';
      const res = await fetch(`${API_URL}${endpoint}`, { credentials: 'include' });
      const data = await res.json();
      if (data.authorization_url) {
        window.open(data.authorization_url, '_blank', 'width=600,height=700');
      } else {
        setError(data.error || `Could not start ${key} connect`);
      }
    } catch {
      setError(`Failed to connect ${key}`);
    } finally {
      setConnectLoading(false);
    }
  };

  const submitJotformConnect = async () => {
    const key = jotformApiKey.trim();
    if (!key) { setJotformError('Please enter your API key.'); return; }
    setConnectLoading(true);
    setJotformError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/jotform/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ api_key: key }),
      });
      if (res.ok) {
        await fetchConnectedProviders();
        setProvider('jotform');
        setFormUrl('');
        setConnectDialogProvider(null);
        setJotformApiKey('');
      } else {
        const data = await res.json().catch(() => ({}));
        setJotformError(data.error || 'Invalid API key.');
      }
    } catch {
      setJotformError('Connection failed. Please try again.');
    } finally {
      setConnectLoading(false);
    }
  };

  /** Called when the user dismisses the connect dialog without connecting. */
  const handleConnectDialogClose = () => {
    setConnectDialogProvider(null);
    setJotformApiKey('');
    setJotformError('');
  };

  /** Called after a successful OAuth flow is detected via the focus listener. */
  useEffect(() => {
    // If the connect dialog is open and the provider just became connected, select it
    if (connectDialogProvider && connectedProviders[connectDialogProvider as keyof typeof connectedProviders]) {
      setProvider(connectDialogProvider);
      setFormUrl('');
      setConnectDialogProvider(null);
    }
  }, [connectedProviders, connectDialogProvider]);

  /**
   * Validates and adds a new number (representing days before due date) 
   * to the custom schedule array. Prevents duplicates, out-of-bound numbers, 
   * and limits the array to 30 elements to prevent DB bloat.
   */
  const handleAddCustomDay = () => {
    const day = parseInt(newDayInput);
    if (isNaN(day) || day < 1 || day > 365) {
      setCustomScheduleError('Please enter a valid number between 1 and 365');
      return;
    }
    if (customDays.includes(day)) {
      setCustomScheduleError('This day is already in your schedule');
      return;
    }
    if (customDays.length >= 30) {
      setCustomScheduleError('Maximum 30 reminder days allowed');
      return;
    }
    setCustomDays([...customDays, day]);
    setNewDayInput('');
    setCustomScheduleError(null);
  };

  /**
   * Primary form submission handler.
   * 1. Validates all required inputs (including dynamic schedule requirements).
   * 2. Constructs the final JSON payload.
   * 3. Handles specific backend errors, particularly detecting if the user's 
   * Google OAuth token has expired and requires a fresh login.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsGoogleReconnect(false);

    // ── Client-side validation ──────────────────────────────────────────

    if (!requestTitle.trim()) { setError('Please enter a request title'); return; }

    if (!formUrl.trim()) { setError('Please enter a form URL'); return; }

    // Basic URL format check per provider
    const trimmedUrl = formUrl.trim();
    if (provider === 'google') {
      if (!/docs\.google\.com\/forms\/d\//.test(trimmedUrl)) {
        setError(
          'That doesn\'t look like a Google Form link. ' +
          'It should contain "docs.google.com/forms/d/…". ' +
          'Make sure you\'re copying the edit or viewform URL from your Google Form.'
        );
        return;
      }
      if (/\/forms\/d\/e\//.test(trimmedUrl)) {
        setError(
          'This looks like a published share link (/d/e/…) which uses a different ID. ' +
          'Please use the edit or viewform link instead — it contains /d/FORM_ID/.'
        );
        return;
      }
    } else if (provider === 'jotform') {
      if (!/jotform\.com/.test(trimmedUrl) && !/^\d{8,}$/.test(trimmedUrl)) {
        setError(
          'That doesn\'t look like a Jotform link or form ID. ' +
          'Paste the full URL (e.g. https://form.jotform.com/242630266486159) or just the numeric form ID.'
        );
        return;
      }
    } else if (provider === 'microsoft') {
      if (!/forms\.(office|microsoft)\.com/.test(trimmedUrl)) {
        setError(
          'That doesn\'t look like a Microsoft Forms link. ' +
          'It should be from forms.office.com or forms.microsoft.com.'
        );
        return;
      }
    }

    // Microsoft Forms requires the title to match the form title exactly
    if (provider === 'microsoft' && !requestTitle.trim()) {
      setError(
        'Microsoft Forms requires a Request Title that exactly matches your form\'s title. ' +
        'We use it to locate the response file in your OneDrive.'
      );
      return;
    }

    if (!groupId) { setError('Please select a recipient group'); return; }
    if (!isValidDate(dueDate)) {
      setError('Please select a valid due date');
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate < today) {
      setError('Due date cannot be in the past');
      return;
    }
    if (
      firstReminderTiming === 'scheduled' &&
      (!isValidDate(scheduledDate) || !isValidDate(scheduledTime))
    ) {
      setError('Please select a valid date and time for the scheduled reminder');
      return;
    }

    setLoading(true);
    try {
      // Construct the base payload
      const requestBody: any = {
        provider,
        form_url: formUrl,
        group_id: groupId,
        title: requestTitle || undefined,
        due_date: dueDate.toISOString(),
        reminder_schedule: reminderSchedule,
        first_reminder_timing: firstReminderTiming,
        is_active: startActive,
      };

      // Append custom schedule data if applicable
      if (reminderSchedule === 'custom') {
        if (customDays.length === 0) {
          setError('Please create a custom schedule with at least one day');
          setLoading(false);
          return;
        }
        requestBody.custom_days = customDays;
      }

      // Append specific start-time data if first reminder is deferred
      if (firstReminderTiming === 'scheduled' && scheduledDate && scheduledTime) {
        requestBody.scheduled_date = scheduledDate.toISOString();
        requestBody.scheduled_time = scheduledTime.toISOString();
      }

      const response = await fetch(`${API_URL}/api/form-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });
      
      const data = await response.json();

      if (!response.ok) {
        // ── Map backend errors to user-friendly messages ──
        const code = data.code || '';
        const action = data.action_required || '';
        const rawError = (data.error || '').toLowerCase();
        const providerLabel = provider === 'google' ? 'Google' : provider === 'jotform' ? 'Jotform' : 'Microsoft';

        // 1) Provider not connected / token expired
        if (
          action === 'reconnect_google' ||
          action.startsWith('connect_') ||
          (response.status === 403 && rawError.includes('not connected'))
        ) {
          setNeedsGoogleReconnect(true);
          throw new Error(
            `Your ${providerLabel} account is not connected or the connection expired. ` +
            `Please reconnect it using the button below.`
          );
        }

        // 2) Could not extract a form ID from the URL
        if (rawError.includes('could not extract') || rawError.includes('form id')) {
          throw new Error(
            `We couldn't find a valid form ID in that URL. ` +
            `Double-check that you copied the full link from ${providerLabel} and that it matches the expected format shown below the URL field.`
          );
        }

        // 3) Microsoft Excel file not found
        if (code === 'microsoft_excel_not_found') {
          throw new Error(
            data.message ||
            'No matching Excel file found in OneDrive. Make sure the request title matches your Microsoft Form title exactly, ' +
            'you\'ve submitted at least one test response, and clicked "Open in Excel" on the Responses tab.'
          );
        }

        // 4) Group not found
        if (rawError.includes('group not found')) {
          throw new Error('The selected group no longer exists. Please choose a different group or create a new one.');
        }

        // 5) Group ownership
        if (rawError.includes('don\'t own') || rawError.includes('do not own')) {
          throw new Error('You can only create requests for groups you own.');
        }

        // 6) Generic fallback — use the backend message if it exists, otherwise a helpful default
        throw new Error(
          data.message || data.error || 'Something went wrong creating the form request. Please try again.'
        );
      }

      // Success — clear the draft so stale data doesn't hang around
      clearDraft();
      setNeedsGoogleReconnect(false);
      navigate('/');
      
    } catch (err: any) {
      setError(err.message || 'Failed to create form request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Container maxWidth="md" sx={{ py: 4 }} className="page-fade-in">
        {/* Page title */}
        <Box mb={4}>
          <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
            New Form Request <AnimatedInfoButton title="How to create a form request">
                                <p>Use this form to create a new form request and send it to your recipients.</p>
                                <p>Start by entering the title of your request and the URL of your Form. Then select a recipient group, set a due date, and choose your reminder schedule.</p>
                                <p>Once you create the request, reminders will automatically be sent to your recipients based on the schedule you set.</p>
                                
                              </AnimatedInfoButton>
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Set up a form, assign recipients, and configure your reminder schedule.
          </Typography>
        </Box>

        <ErrorSnackbar
          error={error}
          onClose={() => { setError(null); setNeedsGoogleReconnect(false); }}
          action={
            needsGoogleReconnect ? (
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/login/google`, { credentials: 'include' });
                    const data = await res.json();
                    if (data.authorization_url) {
                      window.location.href = data.authorization_url;
                    } else {
                      setError(data.error || 'Could not start Google connect');
                    }
                  } catch {
                    setError('Could not start Google connect');
                  }
                }}
              >
                Connect Google
              </Button>
            ) : undefined
          }
        />

        <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={3}>

          {/* ── Section 1: Recipients (shown first so users pick a group early) ── */}
          <Paper
            elevation={0}
            sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
          >
            <SectionHeader
              icon={<GroupIcon sx={{ fontSize: 22 }} />}
              title="Recipients"
              description="Choose which group should receive this form request."
              iconBg="success.50"
              iconColor="success.main"
            />
            <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
              <FormControl size="small" sx={{ flex: 1, minWidth: 200 }} required>
                <InputLabel>Select Group</InputLabel>
                <Select
                  value={groupId}
                  label="Select Group"
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  {groups.length === 0 ? (
                    <MenuItem disabled>No groups available</MenuItem>
                  ) : (
                    groups.map((group) => (
                      <MenuItem key={group.id} value={group.id}>
                        {group.name}
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          ({group.member_count} members)
                        </Typography>
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  // Save the current draft so it's restored when the user comes back
                  saveDraft();
                  navigate('/groups/new?returnTo=create-request');
                }}
                sx={{ flexShrink: 0, height: 40 }}
              >
                New Group
              </Button>
            </Box>
          </Paper>

          {/* ── Section 2: General ── */}
          <Paper
            elevation={0}
            sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
          >
            <SectionHeader
              icon={<DescriptionIcon sx={{ fontSize: 22 }} />}
              title="General Information"
              description="Choose a form provider, name this request, and paste in the form link."
            />
            <Box display="flex" flexDirection="column" gap={2.5}>
              {/* Provider selector */}
              <FormControl size="small" fullWidth required>
                <InputLabel>Form Provider</InputLabel>
                <Select
                  value={provider}
                  label="Form Provider"
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  {(['google', 'jotform', 'microsoft'] as const).map((key) => (
                    <MenuItem key={key} value={key}>
                      <Box display="flex" alignItems="center" gap={1} width="100%">
                        {key === 'google' ? 'Google Forms' : key === 'jotform' ? 'Jotform' : 'Microsoft Forms'}
                        {connectedProviders[key] && (
                          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', ml: 'auto' }} />
                        )}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Request Title"
                fullWidth
                size="small"
                placeholder="e.g. Q1 Survey — Team Alpha"
                value={requestTitle}
                onChange={(e) => setRequestTitle(e.target.value)}
                inputProps={{ maxLength: 50 }} // Limit name to 50
                helperText={`${requestTitle.length}/50`}
              />

              <Box>
                <TextField
                  label={
                    provider === 'google'
                      ? 'Google Form URL'
                      : provider === 'jotform'
                        ? 'Jotform URL or Form ID'
                        : 'Microsoft Form URL'
                  }
                  fullWidth
                  size="small"
                  required
                  placeholder={
                    provider === 'google'
                      ? 'https://docs.google.com/forms/d/…/edit  or  /viewform'
                      : provider === 'jotform'
                        ? 'https://form.jotform.com/242630266486159'
                        : 'https://forms.office.com/r/AbCdEf1234'
                  }
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                />

                {/* Provider-specific helper text */}
                {provider === 'google' && (
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.75} ml={0.25}>
                    Paste the form's <strong>edit</strong> or <strong>viewform</strong> link (URL contains <code>/d/FORM_ID/</code>). Published share links (<code>/d/e/…</code>) use a different ID and won't work.
                  </Typography>
                )}
                {provider === 'jotform' && (
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.75} ml={0.25}>
                    Paste your Jotform URL (e.g. <code>https://form.jotform.com/242630266486159</code>) or just the numeric form ID.
                    Make sure the form has an <strong>email field</strong> so we can match responses to recipients.
                  </Typography>
                )}
                {provider === 'microsoft' && (
                  <Alert severity="info" sx={{ mt: 1 }} variant="outlined">
                    <Typography variant="caption" display="block" gutterBottom>
                      <strong>How to set up your Microsoft Form:</strong>
                    </Typography>
                    <Typography variant="caption" display="block" component="div">
                      1. Open your form in <strong>Microsoft Forms</strong><br />
                      2. Add an <strong>email question</strong> to your form (e.g. "Your email address") — Microsoft
                         Forms shows respondents as "Anonymous" so we need this field to identify who responded<br />
                      3. <strong>Fill out at least one test response</strong> yourself — this is required before
                         Microsoft Forms will let you export to Excel<br />
                      4. Go to the <strong>Responses</strong> tab → click <strong>"Open in Excel"</strong> to
                         create the response spreadsheet in your OneDrive<br />
                      5. Click the <strong>"Collect responses"</strong> button (or <strong>Share</strong>) and
                         copy the link — it will look like <code>https://forms.office.com/r/AbCdEf1234</code><br />
                      6. Enter the <strong>Request Title</strong> above — it must match your Microsoft Form title exactly<br />
                      7. Paste the link above
                    </Typography>
                    <Typography variant="caption" display="block" mt={0.5} sx={{ color: 'warning.dark' }}>
                      <strong>Important:</strong> The request title must <em>exactly</em> match the title of your
                      Microsoft Form. We use it to find the response Excel file in your OneDrive. If the names
                      don't match, creation will fail.
                    </Typography>
                  </Alert>
                )}
              </Box>
            </Box>
          </Paper>

          {/* ── Section 3: Schedule & Deadline ── */}
          <Paper
            elevation={0}
            sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
          >
            <SectionHeader
              icon={<CalendarTodayIcon sx={{ fontSize: 22 }} />}
              title="Schedule & Deadline"
              description="Set a due date and how often reminders go out."
              iconBg="info.50"
              iconColor="info.main"
            />

            {/* Due date */}
            <Box mb={3}>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Due Date <Typography component="span" color="error">*</Typography>
              </Typography>
              <DatePicker
                value={isValidDate(dueDate) ? dueDate : null}
                onChange={(v) => setDueDate(sanitizePickerDate(v))}
                minDate={new Date()}
                slotProps={{
                  textField: { size: 'small', fullWidth: true, required: true },
                }}
              />
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* Reminder frequency */}
            <Box mb={3}>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Reminder Frequency
              </Typography>
              <RadioGroup
                value={reminderSchedule}
                onChange={(e) => {
                  setReminderSchedule(e.target.value);
                  // Clear custom days if the user switches back to a standard preset
                  if (e.target.value !== 'custom') setCustomDays([]);
                }}
              >
                <FormControlLabel
                  value="gentle"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Gentle — 3 and 1 days before</Typography>}
                />
                <FormControlLabel
                  value="normal"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Normal — 5, 3, and 1 days before</Typography>}
                />
                <FormControlLabel
                  value="frequent"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Frequent — daily for the last two weeks</Typography>}
                />
                {customDays.length > 0 && (
                  <FormControlLabel
                    value="custom"
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="body2">
                        Custom —{' '}
                        {customDays
                          .sort((a, b) => b - a)
                          .map((d) => `${d} day${d !== 1 ? 's' : ''}`)
                          .join(', ')}{' '}
                        before
                      </Typography>
                    }
                  />
                )}
              </RadioGroup>

              {/* Editable custom chips that appear below the radio buttons */}
              {reminderSchedule === 'custom' && customDays.length > 0 && (
                <Box display="flex" flexWrap="wrap" gap={1} mt={1.5} ml={3.5}>
                  {customDays
                    .sort((a, b) => b - a)
                    .map((day) => (
                      <Chip
                        key={day}
                        label={`${day} day${day !== 1 ? 's' : ''} before`}
                        size="small"
                        onDelete={() => {
                          const updated = customDays.filter((d) => d !== day);
                          setCustomDays(updated);
                          // Revert to normal if user deletes the final custom chip
                          if (updated.length === 0) setReminderSchedule('normal');
                        }}
                      />
                    ))}
                </Box>
              )}

              <Button
                variant="text"
                size="small"
                sx={{ mt: 1.5, textTransform: 'none', fontWeight: 'medium' }}
                onClick={() => setCustomScheduleOpen(true)}
              >
                {customDays.length > 0 ? 'Edit Custom Schedule' : '+ Create Custom Schedule'}
              </Button>
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* First reminder timing */}
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                First Reminder Timing
              </Typography>
              <RadioGroup
                value={firstReminderTiming}
                onChange={(e) => setFirstReminderTiming(e.target.value)}
              >
                <FormControlLabel
                  value="immediate"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Send immediately after creating this request</Typography>}
                />
                <FormControlLabel
                  value="scheduled"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Schedule for a specific date and time</Typography>}
                />
              </RadioGroup>

              {firstReminderTiming === 'scheduled' && (
                <Box display="flex" gap={2} mt={2} flexWrap="wrap" ml={{ xs: 0, sm: 3.5 }}>
                  <DatePicker
                    label="Start Date"
                    value={isValidDate(scheduledDate) ? scheduledDate : null}
                    onChange={(v) => setScheduledDate(sanitizePickerDate(v))}
                    slotProps={{
                      textField: { size: 'small', sx: { flex: 1, minWidth: 160 } },
                    }}
                  />
                  <TimePicker
                    label="Start Time"
                    value={isValidDate(scheduledTime) ? scheduledTime : null}
                    onChange={(v) => setScheduledTime(sanitizePickerDate(v))}
                    slotProps={{
                      textField: { size: 'small', sx: { flex: 1, minWidth: 160 } },
                    }}
                  />
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Start as Active or Inactive */}
            <FormControlLabel
              control={
                <Switch
                  checked={startActive}
                  onChange={(e) => setStartActive(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    Start as {startActive ? 'Active' : 'Inactive'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {startActive
                      ? 'Reminders will begin sending according to the schedule above.'
                      : 'Reminders will be paused until you manually activate this request.'}
                  </Typography>
                </Box>
              }
            />
          </Paper>

          {/* ── Submit row ── */}
          <Box display="flex" justifyContent="flex-end" gap={2} pb={2}>
            <Button
              variant="outlined"
              onClick={() => { clearDraft(); navigate('/'); }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
              sx={{ minWidth: 180 }}
            >
              {loading ? 'Creating…' : 'Create Request'}
            </Button>
          </Box>
        </Box>

        {/* ── Custom Schedule Dialog ── */}
        <Dialog
          open={customScheduleOpen}
          onClose={() => { setCustomScheduleOpen(false); setCustomScheduleError(null); setNewDayInput(''); }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6" component="span">Custom Schedule <AnimatedInfoButton title="Custom Schedules">
                  <p>Custom schedules let you choose exactly which days reminders go out before the due date. You can add as many days as you want.</p>
                </AnimatedInfoButton>
              </Typography>
              <IconButton size="small" onClick={() => { setCustomScheduleOpen(false); setCustomScheduleError(null); setNewDayInput(''); }}>
                <CloseIcon />
              </IconButton>
            </Box>
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Enter the number of days before the due date you want reminders sent. You can add up to 30 days.
            </Typography>

            {customScheduleError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setCustomScheduleError(null)}>
                {customScheduleError}
              </Alert>
            )}

            <Box display="flex" gap={1} mb={2.5}>
              <TextField
                label="Days before due date"
                type="number"
                value={newDayInput}
                onChange={(e) => {
                  const v = e.target.value;
                  // Allow empty string to clear the box, otherwise enforce bounds
                  if (v === '' || (Number(v) > 0 && Number(v) <= 365)) setNewDayInput(v);
                  setCustomScheduleError(null);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomDay(); } }}
                inputProps={{ min: 1, max: 365 }}
                size="small"
                fullWidth
                helperText="Between 1 and 365"
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleAddCustomDay}
                disabled={!newDayInput || isNaN(parseInt(newDayInput))}
                sx={{ height: 40, flexShrink: 0 }}
              >
                Add
              </Button>
            </Box>

            {customDays.length > 0 ? (
              <Box>
                <Typography variant="body2" fontWeight="medium" gutterBottom>
                  Your schedule ({customDays.length} day{customDays.length !== 1 ? 's' : ''}):
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {customDays
                    .sort((a, b) => b - a)
                    .map((day) => (
                      <Chip
                        key={day}
                        label={`${day} day${day !== 1 ? 's' : ''} before`}
                        onDelete={() => setCustomDays(customDays.filter((d) => d !== day))}
                      />
                    ))}
                </Box>
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled">
                No days added yet.
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => { setCustomScheduleOpen(false); setCustomScheduleError(null); setNewDayInput(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={customDays.length === 0}
              onClick={() => {
                if (customDays.length === 0) { setCustomScheduleError('Add at least one day.'); return; }
                setReminderSchedule('custom');
                setCustomScheduleOpen(false);
                setCustomScheduleError(null);
                setNewDayInput('');
              }}
            >
              Save Schedule
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Provider Connect Dialog ── */}
        <Dialog
          open={!!connectDialogProvider}
          onClose={handleConnectDialogClose}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon fontSize="small" />
            Connect {connectDialogProvider === 'google' ? 'Google Forms' : connectDialogProvider === 'jotform' ? 'Jotform' : 'Microsoft Forms'}
          </DialogTitle>
          <DialogContent>
            {connectDialogProvider === 'jotform' ? (
              <>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Enter your Jotform API key. You can find it at{' '}
                  <a href="https://www.jotform.com/myaccount/api" target="_blank" rel="noopener noreferrer">
                    jotform.com/myaccount/api
                  </a>.
                </Typography>
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  label="API Key"
                  value={jotformApiKey}
                  onChange={(e) => setJotformApiKey(e.target.value)}
                  error={!!jotformError}
                  helperText={jotformError}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitJotformConnect(); }}
                />
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                You need to connect your {connectDialogProvider === 'google' ? 'Google' : 'Microsoft'} account before
                creating form requests with this provider. Click the button below to authorize.
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleConnectDialogClose}>Cancel</Button>
            {connectDialogProvider === 'jotform' ? (
              <Button variant="contained" onClick={submitJotformConnect} disabled={connectLoading}>
                {connectLoading ? <CircularProgress size={16} /> : 'Connect'}
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={connectLoading}
                onClick={() => connectOAuthProvider(connectDialogProvider!)}
              >
                {connectLoading ? <CircularProgress size={16} /> : 'Authorize'}
              </Button>
            )}
          </DialogActions>
        </Dialog>
      </Container>
    </LocalizationProvider>
  );
}