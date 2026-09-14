// SPDX-License-Identifier: AGPL-3.0-only

/** SET-011 and DES-084 introduce the Portal and persist the Business User's first run. */

import { useEffect, useRef, useState } from "react";
import { redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Scale } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { AVATAR_BYTE_LIMIT, AVATAR_TYPES } from "../lib/avatar";
import { currentUserFor, useSignOut } from "../lib/session";
import { networkError } from "../lib/messages";
import { problem } from "../lib/problem";
import { applyPreferredTheme, THEMES, type Theme } from "../lib/theme";
import { CONTROL_CLASS } from "../lib/form-controls";
import { Avatar } from "../components/avatar";
import { PageTitle } from "../components/page-title";
import { SkipLink } from "../components/skip-link";
import { StatusNote, type FieldStatus } from "../components/status-note";
import {
  NotificationSwitchGrid,
  useNotificationPreferences,
} from "../components/notification-preferences";
import { PORTAL_COPY, PORTAL_GROUPS } from "../components/portal/notification-preferences";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const COPY = defineMessages({
  title: { id: "portal.onboarding.title", defaultMessage: "We need to learn a little about you" },
  department: { id: "portal.onboarding.department", defaultMessage: "Department" },
  profile: { id: "portal.onboarding.profile", defaultMessage: "Name and photo" },
  theme: { id: "portal.onboarding.theme", defaultMessage: "Theme" },
  notifications: { id: "portal.onboarding.notifications", defaultMessage: "Notifications" },
  tour: { id: "portal.onboarding.tour", defaultMessage: "A short tour" },
  light: { id: "theme.light", defaultMessage: "Light" },
  warm: { id: "theme.warm", defaultMessage: "Warm" },
  dark: { id: "theme.dark", defaultMessage: "Dark" },
});
type Step = "department" | "profile" | "theme" | "notifications" | "tour";
type Field = "department" | "name" | "photo" | "theme";
type Note = { status: FieldStatus; detail?: string };

export async function portalOnboardingLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/enter");
  if (user.role !== "business_user") return redirect("/settings/profile");
  if (user.portalOnboardingCompletedAt) return redirect("/portal");
  const [onboarding, preferences] = await Promise.all([
    api.GET("/api/v1/portal/onboarding"),
    api.GET("/api/v1/me/notification-preferences"),
  ]);
  if (!onboarding.data || !preferences.data)
    throw new Error("Your first-run settings could not be read.");
  if (onboarding.data.completedAt) return redirect("/portal");
  return { user, onboarding: onboarding.data, groups: preferences.data.groups };
}

export function PortalOnboardingPage() {
  const loaded = useLoaderData<typeof portalOnboardingLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const signOut = useSignOut("/portal/enter");
  const [departments, setDepartments] = useState(loaded.onboarding.departments);
  const [departmentId, setDepartmentId] = useState(loaded.onboarding.departmentId);
  const [step, setStep] = useState<Step>(departments.length ? "department" : "profile");
  const [name, setName] = useState(loaded.user.displayName);
  const [savedName, setSavedName] = useState(loaded.user.displayName);
  const [image, setImage] = useState(loaded.user.image);
  const [theme, setTheme] = useState<Theme>(loaded.user.theme);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [notes, setNotes] = useState<Record<Field, Note>>({
    department: { status: "idle" },
    name: { status: "idle" },
    photo: { status: "idle" },
    theme: { status: "idle" },
  });
  const [finishError, setFinishError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const notificationState = useNotificationPreferences(loaded.groups);
  const steps: Step[] = departments.length
    ? ["department", "profile", "theme", "notifications", "tour"]
    : ["profile", "theme", "notifications", "tour"];
  const index = steps.indexOf(step);
  const validDepartment = departments.some((department) => department.id === departmentId);
  const saving = busy || notificationState.status === "saving";

  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    applyPreferredTheme(theme);
  }, [theme]);

  async function save(field: Field, write: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotes((previous) => ({ ...previous, [field]: { status: "saving" } }));
    try {
      await write();
      setNotes((previous) => ({ ...previous, [field]: { status: "saved" } }));
    } catch (error) {
      setNotes((previous) => ({
        ...previous,
        [field]: {
          status: "error",
          detail: error instanceof Error ? error.message : networkError(intl),
        },
      }));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function chooseDepartment(id: string) {
    void save("department", async () => {
      const result = await api.PATCH("/api/v1/portal/onboarding/department", {
        body: { departmentId: id },
      });
      if (!result.data) throw new Error((await problem(result)).detail ?? networkError(intl));
      setDepartmentId(result.data.departmentId);
      setFinishError(null);
    });
  }

  function commitName() {
    const next = name.trim();
    if (!next || next === savedName) {
      setName(savedName);
      return;
    }
    void save("name", async () => {
      const result = await authClient.updateUser({ name: next });
      if (result.error) throw new Error(result.error.message ?? networkError(intl));
      setSavedName(next);
      setName(next);
    });
  }

  function uploadPhoto(file?: File) {
    if (!file) return;
    void save("photo", async () => {
      if (!AVATAR_TYPES.includes(file.type) || file.size > AVATAR_BYTE_LIMIT) {
        throw new Error(
          intl.formatMessage({
            id: "portal.onboarding.photo.invalid",
            defaultMessage: "Choose a PNG or JPG photo no larger than 1 MB.",
          }),
        );
      }
      const photo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error(networkError(intl)));
        reader.onerror = () => reject(new Error(networkError(intl)));
        reader.readAsDataURL(file);
      });
      const result = await authClient.updateUser({ image: photo });
      if (result.error) throw new Error(result.error.message ?? networkError(intl));
      setImage(photo);
    });
  }

  function chooseTheme(next: Theme) {
    void save("theme", async () => {
      const result = await api.PATCH("/api/v1/me/preferences", { body: { theme: next } });
      if (!result.data) throw new Error((await problem(result)).detail ?? networkError(intl));
      setTheme(next);
    });
  }

  async function advance() {
    if (pending.current || saving || (step === "department" && !validDepartment)) return;
    if (step !== "tour") {
      setStep(steps[index + 1]!);
      return;
    }
    pending.current = true;
    setBusy(true);
    setFinishError(null);
    try {
      const result = await api.POST("/api/v1/portal/onboarding/complete");
      if (result.data) {
        await navigate("/portal", { replace: true });
        return;
      }
      const refusal = await problem(result);
      setFinishError(refusal.detail ?? networkError(intl));
      if (result.response.status === 400) {
        const fresh = await api.GET("/api/v1/portal/onboarding");
        if (fresh.data) {
          setDepartments(fresh.data.departments);
          setDepartmentId(fresh.data.departmentId);
          if (fresh.data.departments.length) setStep("department");
        }
      }
    } catch {
      setFinishError(networkError(intl));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-canvas text-primary">
      <SkipLink />
      <PageTitle title={intl.formatMessage(COPY.title)} />
      <header className="flex h-(--height-header) items-center justify-between gap-4 border-b border-border-default bg-raised px-page-x">
        <span className="flex items-center gap-2 text-base font-semibold">
          <Scale size={20} aria-hidden="true" />
          <FormattedMessage id="portal.brand" defaultMessage="OpenLaw" />
        </span>
        <Button variant="ghost" onClick={() => void signOut()}>
          <FormattedMessage id="auth.signOut" defaultMessage="Sign out" />
        </Button>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-(--width-portal-col) flex-col gap-6 px-page-x py-8"
      >
        <h1 className="text-2xl font-semibold">
          <FormattedMessage {...COPY.title} />
        </h1>
        <p className="text-sm text-muted">
          <FormattedMessage
            id="portal.onboarding.progress"
            defaultMessage="Step {current} of {total}"
            values={{ current: index + 1, total: steps.length }}
          />
        </p>
        <section
          aria-labelledby="first-run-step"
          className="flex min-w-0 flex-col gap-4 rounded-card border border-border-default bg-raised p-4"
        >
          <h2 id="first-run-step" ref={heading} tabIndex={-1} className="text-lg font-semibold">
            <FormattedMessage {...COPY[step]} />
          </h2>
          {step === "department" && (
            <>
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="portal.onboarding.department.lead"
                  defaultMessage="Choose the Department you work in. Legal uses this to share the right Auto-Docs with you."
                />
              </p>
              <Label htmlFor="first-run-department">
                <FormattedMessage {...COPY.department} />
              </Label>
              <select
                id="first-run-department"
                required
                className={CONTROL_CLASS}
                disabled={saving}
                value={validDepartment ? departmentId! : ""}
                onChange={(event) => chooseDepartment(event.target.value)}
              >
                <option value="" disabled>
                  {intl.formatMessage({
                    id: "portal.onboarding.department.choose",
                    defaultMessage: "Choose your Department",
                  })}
                </option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.displayName}
                  </option>
                ))}
              </select>
              <StatusNote {...notes.department} />
            </>
          )}
          {step === "profile" && (
            <>
              <Label htmlFor="first-run-name">
                <FormattedMessage id="settings.profile.fullName" defaultMessage="Full name" />
              </Label>
              <Input
                id="first-run-name"
                value={name}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
              />
              <StatusNote {...notes.name} />
              <Avatar name={savedName} image={image} className="size-12" />
              <Label htmlFor="first-run-photo">
                <FormattedMessage id="portal.onboarding.photo" defaultMessage="Photo" />
              </Label>
              <Input
                id="first-run-photo"
                type="file"
                accept={AVATAR_TYPES.join(",")}
                disabled={saving}
                onChange={(event) => uploadPhoto(event.target.files?.[0])}
              />
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="portal.onboarding.photo.hint"
                  defaultMessage="PNG or JPG, up to 1 MB."
                />
              </p>
              <StatusNote {...notes.photo} />
            </>
          )}
          {step === "theme" && (
            <>
              <fieldset className="flex flex-wrap gap-4">
                <legend className="sr-only">
                  <FormattedMessage {...COPY.theme} />
                </legend>
                {THEMES.map((option) => (
                  <label key={option} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="theme"
                      value={option}
                      checked={theme === option}
                      disabled={saving}
                      onChange={() => chooseTheme(option)}
                      className="size-4 accent-cta-primary"
                    />
                    <FormattedMessage {...COPY[option]} />
                  </label>
                ))}
              </fieldset>
              <StatusNote {...notes.theme} />
            </>
          )}
          {step === "notifications" && (
            <>
              <NotificationSwitchGrid
                state={notificationState}
                order={PORTAL_GROUPS}
                copy={PORTAL_COPY}
              />
              <StatusNote status={notificationState.status} detail={notificationState.detail} />
            </>
          )}
          {step === "tour" && (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="font-semibold">
                  <FormattedMessage
                    id="portal.onboarding.tour.requests"
                    defaultMessage="Requests"
                  />
                </h3>
                <p className="text-sm text-muted">
                  <FormattedMessage
                    id="portal.onboarding.tour.requests.detail"
                    defaultMessage="Ask Legal for help and follow the progress of your Requests."
                  />
                </p>
              </div>
              <div>
                <h3 className="font-semibold">
                  <FormattedMessage
                    id="portal.onboarding.tour.contracts"
                    defaultMessage="Contracts"
                  />
                </h3>
                <p className="text-sm text-muted">
                  <FormattedMessage
                    id="portal.onboarding.tour.contracts.detail"
                    defaultMessage="Read the Contracts you work on, share Documents, and talk with Legal."
                  />
                </p>
              </div>
              <div>
                <h3 className="font-semibold">
                  <FormattedMessage id="portal.onboarding.tour.matters" defaultMessage="Matters" />
                </h3>
                <p className="text-sm text-muted">
                  <FormattedMessage
                    id="portal.onboarding.tour.matters.detail"
                    defaultMessage="Follow legal work, its Documents, and its conversations."
                  />
                </p>
              </div>
              <div>
                <h3 className="font-semibold">
                  <FormattedMessage
                    id="portal.onboarding.tour.autoDocs"
                    defaultMessage="Auto-Docs"
                  />
                </h3>
                <p className="text-sm text-muted">
                  <FormattedMessage
                    id="portal.onboarding.tour.autoDocs.detail"
                    defaultMessage="Fill in a form to generate a document from an Auto-Doc prepared by Legal."
                  />
                </p>
              </div>
            </div>
          )}
        </section>
        {finishError && (
          <p role="alert" className="text-sm text-status-danger-fg">
            {finishError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={index === 0 || saving}
            onClick={() => setStep(steps[index - 1]!)}
          >
            <FormattedMessage id="portal.onboarding.back" defaultMessage="Back" />
          </Button>
          <div className="flex gap-3">
            {step !== "department" && (
              <Button variant="ghost" disabled={saving} onClick={() => void advance()}>
                <FormattedMessage id="portal.onboarding.skip" defaultMessage="Skip" />
              </Button>
            )}
            <Button
              disabled={saving || (step === "department" && !validDepartment)}
              onClick={() => void advance()}
            >
              {step === "tour" ? (
                <FormattedMessage id="portal.onboarding.finish" defaultMessage="Finish" />
              ) : (
                <FormattedMessage id="portal.onboarding.continue" defaultMessage="Continue" />
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
