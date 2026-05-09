import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, FileDown, QrCode } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  raceId: string;
  raceName: string;
}

export function RaceInviteCard({ raceId, raceName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [exporting, setExporting] = useState(false);

  const url = `${window.location.origin}/races/${raceId}`;

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(() => {});
  }, [url]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié");
    } catch {
      toast.error("Impossible de copier");
    }
  };

  const downloadQr = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 1024,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `qr-${raceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Erreur génération QR");
    }
  };

  const exportEmails = async () => {
    setExporting(true);
    try {
      const { data: regs, error } = await supabase
        .from("race_registrations")
        .select("bib_number, runner_id")
        .eq("race_id", raceId);
      if (error) throw error;

      const ids = (regs ?? []).map((r) => r.runner_id);
      if (ids.length === 0) {
        toast.info("Aucun inscrit");
        return;
      }

      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, email, first_name, last_name")
        .in("user_id", ids);
      if (pErr) throw pErr;

      const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const rows = [
        ["email", "first_name", "last_name", "bib_number", "race_url"],
        ...(regs ?? []).map((r) => {
          const p = byId.get(r.runner_id);
          return [
            p?.email ?? "",
            p?.first_name ?? "",
            p?.last_name ?? "",
            r.bib_number ?? "",
            url,
          ];
        }),
      ];
      const csv = rows
        .map((row) =>
          row
            .map((v) => {
              const s = String(v ?? "");
              return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(","),
        )
        .join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `inscrits-${raceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success(`${(regs ?? []).length} inscrit(s) exporté(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur export");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="glass-card p-5 space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold flex items-center gap-2">
          <QrCode className="h-5 w-5" /> Inviter à s'inscrire
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Partagez le lien ou le QR code de la course, et exportez la liste des inscrits pour
          l'importer dans votre outil d'emailing (Brevo, Mailchimp…).
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-lg bg-white p-2">
            <canvas ref={canvasRef} />
          </div>
          <Button variant="outline" size="sm" onClick={downloadQr}>
            <Download className="h-4 w-4 mr-2" /> Télécharger le QR
          </Button>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Lien public d'inscription</label>
            <div className="flex gap-2">
              <Input readOnly value={url} className="flex-1" />
              <Button variant="outline" onClick={copyLink}>
                <Copy className="h-4 w-4 mr-2" /> Copier
              </Button>
            </div>
          </div>

          <div className="pt-2 border-t border-border/50">
            <p className="text-sm text-muted-foreground mb-2">
              Téléchargez la liste des emails des inscrits pour leur envoyer une invitation
              depuis votre service d'emailing habituel.
            </p>
            <Button onClick={exportEmails} disabled={exporting}>
              <FileDown className="h-4 w-4 mr-2" />
              {exporting ? "Export…" : "Exporter les emails (CSV)"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
