import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  useMyCompletedWorkRequests,
  useRequestOrigins,
  useSubmitCompletedWork,
} from '../../queries/completed-work-requests';

function safeSubmitError(error: unknown) {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : '';
  if (message === 'description_required') return 'Descrierea este obligatorie.';
  if (message === 'invalid_origin')
    return 'Alege un grup pentru această activitate.';
  if (message === 'request_origin_forbidden')
    return 'Nu mai faci parte din grupul ales.';
  return 'Cererea nu a putut fi trimisă. Încearcă din nou.';
}

export default function CompletedWorkRequestScreen() {
  const origins = useRequestOrigins();
  const myRequests = useMyCompletedWorkRequests();
  const submit = useSubmitCompletedWork();
  const [originKey, setOriginKey] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submit.isPending) return;
    const origin = origins.data?.find((item) => item.key === originKey);
    if (!origin || !description.trim()) return;
    try {
      await submit.mutateAsync({ origin, description: description.trim() });
      setDescription('');
      setOriginKey('');
      setSubmitted(true);
    } catch {
      setSubmitted(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <h1 className="text-2xl font-extrabold">
            Cerere pentru activitate realizată
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Descrie contribuția, iar coordonatorii grupului o vor evalua.
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>Activitatea ta</CardTitle>
            <CardDescription id="request-origin-help">
              Alege grupul pentru care ai lucrat: departamentul, echipa sau
              proiectul.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {origins.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Se încarcă grupurile…
              </p>
            ) : origins.isError ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">
                  Nu am putut încărca grupurile.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void origins.refetch()}
                >
                  Încearcă din nou
                </Button>
              </div>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(event) => void onSubmit(event)}
              >
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="request-origin"
                  >
                    Grup
                  </label>
                  <select
                    id="request-origin"
                    aria-describedby="request-origin-help"
                    className="min-h-11 w-full rounded-lg border border-input bg-background px-3"
                    value={originKey}
                    onChange={(event) => {
                      setOriginKey(event.target.value);
                      setSubmitted(false);
                    }}
                    required
                    disabled={!origins.data?.length}
                  >
                    <option value="">Alege grupul</option>
                    {origins.data?.map((origin) => (
                      <option key={origin.key} value={origin.key}>
                        {origin.name}
                      </option>
                    ))}
                  </select>
                  {!origins.data?.length && (
                    <p className="text-sm text-muted-foreground">
                      Nu ai niciun grup activ disponibil pentru cereri.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="request-description"
                  >
                    Descriere
                  </label>
                  <textarea
                    id="request-description"
                    className="min-h-32 w-full rounded-lg border border-input bg-background p-3"
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSubmitted(false);
                    }}
                    placeholder="Ce ai realizat și care a fost rezultatul?"
                    required
                  />
                </div>
                {submit.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {safeSubmitError(submit.error)}
                  </p>
                )}
                {submitted && (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-green-700"
                  >
                    <CheckCircle2 className="size-4" />
                    Cererea a fost trimisă și apare în Cererile mele.
                  </p>
                )}
                <Button
                  className="min-h-11 min-w-11"
                  type="submit"
                  disabled={
                    submit.isPending || !originKey || !description.trim()
                  }
                >
                  {submit.isPending ? 'Se trimite…' : 'Trimite cererea'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        <section className="space-y-3" aria-labelledby="my-requests-title">
          <h2 id="my-requests-title" className="text-lg font-bold">
            Cererile mele
          </h2>
          {myRequests.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Se încarcă cererile…
            </p>
          ) : myRequests.isError ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-destructive">
                Nu am putut încărca cererile tale.
              </p>
              <Button
                variant="outline"
                onClick={() => void myRequests.refetch()}
              >
                Încearcă din nou
              </Button>
            </div>
          ) : myRequests.data?.length ? (
            <ul className="space-y-2">
              {myRequests.data.map((request) => (
                <li key={request.id} className="rounded-lg border bg-card p-4">
                  <p className="wrap-anywhere">{request.description}</p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    {request.status === 'pending'
                      ? 'În așteptare'
                      : request.status === 'approved'
                        ? 'Aprobată'
                        : 'Respinsă'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nu ai trimis încă nicio cerere.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
