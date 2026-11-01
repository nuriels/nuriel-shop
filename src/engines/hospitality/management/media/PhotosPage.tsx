// מסך "תמונות" (/manage/photos) — Stage 2e: גלריית האתר, וסקירה של הגלריות של כל מתחם ויחידה
// (כמה פריטים, התמונה הראשית, קישור לגלריה בעמוד שלהם), ונפח האחסון של העסק.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui";
import { hospitalityGalleries } from "../../api/media.functions";
import type { GalleryCard } from "../../types/media";
import { formatBytes } from "../../validation/media";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { MediaGallery } from "./MediaGallery";

function Thumb({ card }: { card: GalleryCard }) {
  return card.cover?.thumb_url ? (
    <img
      src={card.cover.thumb_url}
      alt={card.cover.alt ?? ""}
      width={96}
      height={72}
      loading="lazy"
      className="h-[72px] w-24 shrink-0 rounded object-cover"
    />
  ) : (
    <div className="flex h-[72px] w-24 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <ImageOff className="size-5" aria-hidden="true" />
    </div>
  );
}

const countText = (n: number) => (n === 0 ? "אין תמונות" : n === 1 ? "פריט אחד" : `${n} פריטים`);

export function PhotosPage() {
  const ctx = useManagement();
  const query = useQuery({
    queryKey: [...manageKeys.all, "galleries"],
    queryFn: () => hospitalityGalleries(),
    refetchOnWindowFocus: false,
  });
  if (!ctx.permissions["media"]) return <p className="p-4">אין לכם הרשאה לנהל תמונות באתר הזה.</p>;
  if (query.isError) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען את התמונות…" />;
  const g = query.data;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">תמונות</h1>
        <p className="text-muted-foreground">
          גלריה לאתר, לכל מתחם ולכל יחידה. נפח האחסון של העסק: {formatBytes(g.usage.bytes)} (
          {g.usage.files} קבצים).
        </p>
      </header>

      <MediaGallery
        galleryRef={{ ownerKind: "site", ownerId: null }}
        title="גלריית האתר"
        description="תמונות כלליות של המקום — לדף הבית ולגלריה הראשית."
        canEdit
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <h2>גלריות המתחמים והיחידות</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {g.properties.length === 0 && (
            <p className="text-sm text-muted-foreground">
              עוד אין מקום אירוח.{" "}
              <Link to="/manage/units" className="font-medium text-primary hover:underline">
                להקמה
              </Link>
            </p>
          )}
          {g.properties.map((p) => (
            <section key={p.id} className="flex flex-col gap-2" data-gallery-property={p.name}>
              <Link
                to="/manage/properties/$propertyId"
                params={{ propertyId: p.id }}
                hash="gallery"
                className="flex items-center gap-3 rounded-md border p-2 hover:bg-muted/50"
              >
                <Thumb card={p} />
                <span className="flex flex-col">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm text-muted-foreground">{countText(p.count)}</span>
                </span>
              </Link>
              <ul className="grid gap-2 ps-4 sm:grid-cols-2">
                {p.units.map((u) => (
                  <li key={u.id} data-gallery-unit={u.name}>
                    <Link
                      to="/manage/units/$unitId"
                      params={{ unitId: u.id }}
                      hash="gallery"
                      className="flex items-center gap-3 rounded-md border p-2 hover:bg-muted/50"
                    >
                      <Thumb card={u} />
                      <span className="flex flex-col">
                        <span className="font-medium">{u.name}</span>
                        <span
                          className={
                            u.count === 0 && u.is_active
                              ? "text-sm text-amber-800"
                              : "text-sm text-muted-foreground"
                          }
                        >
                          {countText(u.count)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
