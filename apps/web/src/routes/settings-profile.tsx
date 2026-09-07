// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Profile (SET-006, #67), from the ST1 frame of settings.pen
 * as amended by SETTINGS-INVENTORY.md delta 4: display name, avatar,
 * change password, TOTP management, sign-out-my-other-devices, and the
 * DES-014 timezone picker. Email and role render read-only. Email
 * change is deferred (FUTURE-FEATURES), and roles are managed in
 * Organization > Users (SET-005). Self-service mutations go through
 * better-auth's mounted routes; the timezone goes through the widened
 * /me/preferences endpoint. The password and two-factor card only
 * renders for accounts with a password credential. TOTP gates password
 * sign-in alone (TECH-008), so neither control means anything to an
 * SSO- or magic-link-only account.
 */

import { useRef, useState, type SubmitEvent as FormSubmitEvent } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { formatShortDate } from "../lib/format";
import { field } from "../lib/forms";
import { networkError } from "../lib/messages";
import { ROLE_MESSAGES, type Role } from "../lib/roles";
import { requireUser } from "../lib/session";
import { Avatar } from "../components/avatar";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { TimezonePicker } from "../components/timezone-picker";
import { BackupCodes, TotpQr } from "../components/two-factor";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsProfileLoader() {
  const user = await requireUser();
  const [session, accounts] = await Promise.all([
    authClient.getSession(),
    authClient.listAccounts(),
  ]);
  // A failed read must fail the pane. Rendering "no password" chrome
  // off a network error would silently hide the credential controls.
  if (session.error || !session.data) throw new Error("The session could not be read.");
  if (accounts.error || !accounts.data) throw new Error("The linked accounts could not be read.");
  const credential = accounts.data.find((account) => account.providerId === "credential");
  return {
    user,
    twoFactorEnabled: session.data.user.twoFactorEnabled === true,
    hasPassword: credential !== undefined,
    passwordChangedAt: credential ? new Date(credential.updatedAt).toISOString() : null,
  };
}

/** JPG or PNG, 1 MB max (ST1); matches the API's cap on the data: URI. */
const AVATAR_BYTE_LIMIT = 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg"];

function RoleLabel({ role }: Readonly<{ role: Role }>) {
  return <FormattedMessage {...ROLE_MESSAGES[role]} />;
}

type TotpDialog =
  | { kind: "password"; mode: "enroll" | "disable" }
  | { kind: "verify"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

export function SettingsProfilePage() {
  const loaded = useLoaderData<typeof settingsProfileLoader>();
  const intl = useIntl();
  const revalidator = useRevalidator();

  const [saved, setSaved] = useState({
    displayName: loaded.user.displayName,
    image: loaded.user.image,
    timezone: loaded.user.timezone,
  });
  const [nameDraft, setNameDraft] = useState(saved.displayName);
  const [status, setStatus] = useState<
    Record<"name" | "avatar" | "timezone" | "sessions" | "password", FieldStatus>
  >({ name: "idle", avatar: "idle", timezone: "idle", sessions: "idle", password: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(loaded.twoFactorEnabled);
  const [totpDialog, setTotpDialog] = useState<TotpDialog | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function note(field: keyof typeof status, value: FieldStatus) {
    setStatus((s) => ({ ...s, [field]: value }));
  }

  function commitName() {
    const name = nameDraft.trim();
    if (name === saved.displayName || name === "") {
      // Nothing to save, or nothing valid. Revert per DES-017.
      setNameDraft(saved.displayName);
      return;
    }
    note("name", "saving");
    void authClient
      .updateUser({ name })
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        setSaved((s) => ({ ...s, displayName: name }));
        setNameDraft(name);
        note("name", "saved");
        // The header renders the loader's user; pull it up to date.
        void revalidator.revalidate();
      })
      .catch(() => note("name", "error"));
  }

  function uploadAvatar(file: File | undefined) {
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type) || file.size > AVATAR_BYTE_LIMIT) {
      note("avatar", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = reader.result as string;
      note("avatar", "saving");
      void authClient
        .updateUser({ image })
        .then((res) => {
          if (res.error) throw new Error(res.error.message);
          setSaved((s) => ({ ...s, image }));
          note("avatar", "saved");
          void revalidator.revalidate();
        })
        .catch(() => note("avatar", "error"));
    };
    reader.onerror = () => note("avatar", "error");
    reader.readAsDataURL(file);
  }

  function commitTimezone(zone: string | null) {
    note("timezone", "saving");
    void api
      .PATCH("/api/v1/me/preferences", { body: { timezone: zone } })
      .then(({ data }) => {
        if (!data) throw new Error("The timezone could not be saved.");
        setSaved((s) => ({ ...s, timezone: data.user.timezone }));
        note("timezone", "saved");
        void revalidator.revalidate();
      })
      .catch(() => note("timezone", "error"));
  }

  function signOutOtherDevices() {
    note("sessions", "saving");
    void authClient
      .revokeOtherSessions()
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        note("sessions", "saved");
      })
      .catch(() => note("sessions", "error"));
  }

  async function changePassword(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = field(form, "currentPassword");
    const newPassword = field(form, "newPassword");
    setDialogBusy(true);
    setDialogError(null);
    try {
      // A password change is often a response to a leak. Every other
      // session dies with the old password. This one stays.
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (res.error) {
        setDialogError(
          intl.formatMessage({
            id: "settings.profile.password.error",
            defaultMessage:
              "The password could not be changed. Check your current password and use at least 8 characters.",
          }),
        );
        return;
      }
      setPasswordOpen(false);
      note("password", "saved");
      void revalidator.revalidate();
    } catch {
      setDialogError(networkError(intl));
    } finally {
      setDialogBusy(false);
    }
  }

  async function startTotp(event: FormSubmitEvent<HTMLFormElement>, mode: "enroll" | "disable") {
    event.preventDefault();
    const password = field(new FormData(event.currentTarget), "password");
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (mode === "disable") {
        const res = await authClient.twoFactor.disable({ password });
        if (res.error) {
          setDialogError(
            intl.formatMessage({
              id: "auth.enroll.error.password",
              defaultMessage: "Check your password.",
            }),
          );
          return;
        }
        setTotpEnabled(false);
        setTotpDialog(null);
        return;
      }
      // Re-enrolment is a disable and then an enrolment. From better-auth
      // 1.7.3 `enable` refuses while a verified authenticator is active
      // (TOTP_ALREADY_ENABLED) rather than replacing it — an unfinished
      // re-enrolment used to leave a secret nobody had proven. The window
      // between the two is the same as an abandoned enrolment: two-factor
      // off, the pane saying so, sign-in still working.
      if (totpEnabled) {
        const off = await authClient.twoFactor.disable({ password });
        if (off.error) {
          setDialogError(
            intl.formatMessage({
              id: "auth.enroll.error.password",
              defaultMessage: "Check your password.",
            }),
          );
          return;
        }
        setTotpEnabled(false);
      }
      const res = await authClient.twoFactor.enable({ password });
      if (res.error || !res.data) {
        setDialogError(
          intl.formatMessage({
            id: "auth.enroll.error.password",
            defaultMessage: "Check your password.",
          }),
        );
        return;
      }
      // From better-auth 1.7 the answer says which second factor it
      // enrolled. TOTP is the only one this install can return, because
      // the e-mail OTP fallback is not configured on purpose (no sendOTP,
      // TECH-008). Anything else is a misconfiguration, not a state this
      // dialog can walk the user through.
      if (res.data.method !== "totp") {
        setDialogError(
          intl.formatMessage({
            id: "auth.enroll.error.method",
            defaultMessage:
              "Two-factor authentication is not configured correctly on this install. Contact an Administrator.",
          }),
        );
        return;
      }
      setTotpDialog({
        kind: "verify",
        totpURI: res.data.totpURI,
        backupCodes: res.data.backupCodes,
      });
    } catch {
      setDialogError(networkError(intl));
    } finally {
      setDialogBusy(false);
    }
  }

  async function verifyTotp(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (totpDialog?.kind !== "verify") return;
    const code = field(new FormData(event.currentTarget), "code").trim();
    setDialogBusy(true);
    setDialogError(null);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setDialogError(
          intl.formatMessage({
            id: "auth.enroll.error.code",
            defaultMessage: "Wrong code. Scan the QR code again and retry.",
          }),
        );
        return;
      }
      setTotpEnabled(true);
      setTotpDialog({ kind: "codes", backupCodes: totpDialog.backupCodes });
    } catch {
      setDialogError(networkError(intl));
    } finally {
      setDialogBusy(false);
    }
  }

  function openTotpDialog(mode: "enroll" | "disable") {
    setDialogError(null);
    setTotpDialog({ kind: "password", mode });
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({ id: "settings.section.profile", defaultMessage: "Profile" })}
      />

      <SettingsCard
        title={<FormattedMessage id="settings.section.profile" defaultMessage="Profile" />}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={saved.displayName} image={saved.image} className="size-16 text-lg" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-primary">
                <FormattedMessage id="settings.profile.photo" defaultMessage="Profile photo" />
              </span>
              <span className="text-xs text-muted">
                <FormattedMessage
                  id="settings.profile.photo.hint"
                  defaultMessage="JPG or PNG, 1 MB max."
                />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={AVATAR_TYPES.join(",")}
              // Visually hidden but still in the accessibility tree, so
              // it carries its own name. The Upload button drives it.
              aria-label={intl.formatMessage({
                id: "settings.profile.uploadPhoto",
                defaultMessage: "Upload a profile photo",
              })}
              className="sr-only"
              onChange={(event) => {
                uploadAvatar(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
              <FormattedMessage id="settings.profile.upload" defaultMessage="Upload" />
            </Button>
            <StatusNote status={status.avatar} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">
            <FormattedMessage id="settings.profile.fullName" defaultMessage="Full name" />
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="profile-name"
              className="w-80"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") setNameDraft(saved.displayName);
              }}
            />
            <StatusNote status={status.name} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">
            <FormattedMessage id="settings.profile.email" defaultMessage="Email" />
          </Label>
          {/* Read-only: self-service email change is deferred (SET-006). */}
          <Input
            id="profile-email"
            className="w-80 text-muted"
            value={loaded.user.email}
            readOnly
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-primary">
            <FormattedMessage id="settings.profile.role" defaultMessage="Role" />
          </span>
          <span className="inline-flex self-start rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-status-neutral-fg">
            <RoleLabel role={loaded.user.role} />
          </span>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.profile.role.hint"
              defaultMessage="Roles are managed in Organization → Users."
            />
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-timezone">
            <FormattedMessage id="settings.profile.timezone" defaultMessage="Timezone" />
          </Label>
          <div className="flex items-center gap-2">
            <TimezonePicker
              id="profile-timezone"
              value={saved.timezone}
              onCommit={commitTimezone}
              allowBrowserDefault
            />
            <StatusNote status={status.timezone} />
          </div>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.profile.timezone.hint"
              defaultMessage="Dates and times display in this timezone."
            />
          </p>
        </div>
      </SettingsCard>

      {loaded.hasPassword && (
        <SettingsCard
          title={
            <FormattedMessage
              id="settings.profile.passwordTwoFactor"
              defaultMessage="Password & two-factor"
            />
          }
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted">
              {loaded.passwordChangedAt ? (
                <FormattedMessage
                  id="settings.profile.passwordChanged"
                  defaultMessage="Last changed {date}."
                  values={{ date: formatShortDate(loaded.passwordChangedAt) }}
                />
              ) : (
                <FormattedMessage
                  id="settings.profile.passwordSet"
                  defaultMessage="A password is set."
                />
              )}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPasswordOpen(true)}>
                <FormattedMessage
                  id="settings.profile.changePassword"
                  defaultMessage="Change password"
                />
              </Button>
              <StatusNote status={status.password} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border-default pt-4">
            <span className="text-sm text-muted">
              {totpEnabled ? (
                <FormattedMessage
                  id="settings.profile.twoFactorOn"
                  defaultMessage="Two-factor is on — a code is required when you sign in with your password."
                />
              ) : (
                <FormattedMessage
                  id="settings.profile.twoFactorOff"
                  defaultMessage="Two-factor is off — your password alone signs you in."
                />
              )}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {totpEnabled ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => openTotpDialog("enroll")}>
                    <FormattedMessage id="settings.profile.reenroll" defaultMessage="Re-enroll" />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openTotpDialog("disable")}>
                    <FormattedMessage
                      id="auth.enroll.disable"
                      defaultMessage="Turn off two-factor"
                    />
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => openTotpDialog("enroll")}>
                  <FormattedMessage id="auth.enroll.enable" defaultMessage="Turn on two-factor" />
                </Button>
              )}
            </div>
          </div>
        </SettingsCard>
      )}

      <SettingsCard
        title={<FormattedMessage id="settings.profile.sessions" defaultMessage="Sessions" />}
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted">
            <FormattedMessage
              id="settings.profile.sessions.hint"
              defaultMessage="Ends every session except this one."
            />
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={signOutOtherDevices}>
              <FormattedMessage
                id="settings.profile.signOutOthers"
                defaultMessage="Sign out other devices"
              />
            </Button>
            <StatusNote status={status.sessions} />
          </div>
        </div>
      </SettingsCard>

      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open) setDialogError(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <form className="flex flex-col gap-4" onSubmit={(e) => void changePassword(e)}>
            <DialogTitle>
              <FormattedMessage
                id="settings.profile.changePassword"
                defaultMessage="Change password"
              />
            </DialogTitle>
            {dialogError && <Alert variant="danger">{dialogError}</Alert>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">
                <FormattedMessage
                  id="settings.profile.currentPassword"
                  defaultMessage="Current password"
                />
              </Label>
              <Input
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">
                <FormattedMessage id="settings.profile.newPassword" defaultMessage="New password" />
              </Label>
              <Input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="settings.profile.passwordRevokesSessions"
                defaultMessage="Saving signs you out on your other devices."
              />
            </p>
            <div className="flex items-center gap-2 self-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPasswordOpen(false)}
                disabled={dialogBusy}
              >
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              <Button type="submit" disabled={dialogBusy}>
                <FormattedMessage id="action.save" defaultMessage="Save" />
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={totpDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTotpDialog(null);
            setDialogError(null);
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          // The backup codes are shown this once and never again: an
          // accidental Esc or outside click must not throw them away.
          // Done is the only way off that step.
          onEscapeKeyDown={(event) => {
            if (totpDialog?.kind === "codes") event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (totpDialog?.kind === "codes") event.preventDefault();
          }}
        >
          {totpDialog?.kind === "password" && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => void startTotp(e, totpDialog.mode)}
            >
              <DialogTitle>
                {totpDialog.mode === "disable" ? (
                  <FormattedMessage id="auth.enroll.disable" defaultMessage="Turn off two-factor" />
                ) : (
                  <FormattedMessage id="auth.enroll.enable" defaultMessage="Turn on two-factor" />
                )}
              </DialogTitle>
              {dialogError && <Alert variant="danger">{dialogError}</Alert>}
              <p className="text-sm text-muted">
                {totpDialog.mode === "disable" ? (
                  <FormattedMessage
                    id="auth.enroll.disablePassword"
                    defaultMessage="Confirm your password to turn it off"
                  />
                ) : (
                  <FormattedMessage
                    id="auth.enroll.passwordHint"
                    defaultMessage="Confirm your password to start enrollment."
                  />
                )}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="totp-password">
                  <FormattedMessage id="auth.field.password" defaultMessage="Password" />
                </Label>
                <Input
                  id="totp-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" disabled={dialogBusy} className="self-end">
                <FormattedMessage id="action.continue" defaultMessage="Continue" />
              </Button>
            </form>
          )}

          {totpDialog?.kind === "verify" && (
            <div className="flex flex-col gap-4">
              <DialogTitle>
                <FormattedMessage
                  id="settings.profile.twoFactor"
                  defaultMessage="Two-factor authentication"
                />
              </DialogTitle>
              {dialogError && <Alert variant="danger">{dialogError}</Alert>}
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="auth.enroll.verifyHint"
                  defaultMessage="Scan the QR code with your authenticator app, then enter the code it shows."
                />
              </p>
              <TotpQr totpURI={totpDialog.totpURI} />
              <form className="flex flex-col gap-4" onSubmit={(e) => void verifyTotp(e)}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="totp-code">
                    <FormattedMessage id="auth.twoFactor.totpField" defaultMessage="Code" />
                  </Label>
                  <Input
                    id="totp-code"
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                  />
                </div>
                <Button type="submit" disabled={dialogBusy} className="self-end">
                  <FormattedMessage id="auth.enroll.confirm" defaultMessage="Confirm" />
                </Button>
              </form>
            </div>
          )}

          {totpDialog?.kind === "codes" && (
            <div className="flex flex-col gap-4">
              <DialogTitle>
                <FormattedMessage
                  id="settings.profile.twoFactor"
                  defaultMessage="Two-factor authentication"
                />
              </DialogTitle>
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="auth.enroll.codesHint"
                  defaultMessage="Two-factor authentication is on. Save these backup codes somewhere safe — each works once, and they are shown only now."
                />
              </p>
              <BackupCodes codes={totpDialog.backupCodes}>
                <Button variant="link" onClick={() => setTotpDialog(null)}>
                  <FormattedMessage id="action.done" defaultMessage="Done" />
                </Button>
              </BackupCodes>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
