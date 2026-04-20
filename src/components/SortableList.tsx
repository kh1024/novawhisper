// Generic drag-and-drop sortable list with grip-handle + optional hide button.
// Order persists to localStorage under the given storageKey. Hidden ids are
// filtered out and animated away with framer-motion's AnimatePresence.
import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

function readOrder(key: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeOrder(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(ids));
}

/** Reconcile a saved order with the current set of ids — drops removed, appends new. */
export function reconcileOrder(saved: string[] | null, all: string[]): string[] {
  if (!saved) return all;
  const allSet = new Set(all);
  const savedSet = new Set(saved);
  const filtered = saved.filter((id) => allSet.has(id));
  const additions = all.filter((id) => !savedSet.has(id));
  return [...filtered, ...additions];
}

interface SortableItemProps {
  id: string;
  children: (handle: ReactNode, hideButton: ReactNode | null) => ReactNode;
  className?: string;
  onHide?: (id: string) => void;
}

function SortableItem({ id, children, className, onHide }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto" as const,
  };
  const handle = (
    <button
      type="button"
      ref={setNodeRef as never}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="touch-none cursor-grab active:cursor-grabbing inline-flex items-center justify-center rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  const hideButton = onHide ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onHide(id); }}
      aria-label="Hide this section (find it in Settings to restore)"
      title="Hide section — restore from Settings"
      className="inline-flex items-center justify-center rounded p-1 text-muted-foreground/60 hover:text-bearish hover:bg-bearish/10 transition-colors"
    >
      <X className="h-4 w-4" />
    </button>
  ) : null;
  return (
    <div ref={setNodeRef} style={style} className={cn(className, isDragging && "ring-2 ring-primary/40 rounded-lg")}>
      {children(handle, hideButton)}
    </div>
  );
}

interface SortableListProps<T extends { id: string }> {
  items: T[];
  storageKey: string;
  /** Render each item; receives the item, drag-handle node, and (optional) hide button node. */
  renderItem: (item: T, handle: ReactNode, hideButton: ReactNode | null) => ReactNode;
  itemClassName?: string;
  className?: string;
  /** Set of ids to filter out (driven by useHiddenSections). */
  hiddenIds?: Set<string>;
  /** When provided, each item shows an X button that calls this with its id. */
  onHide?: (id: string) => void;
}

export function SortableList<T extends { id: string }>({
  items,
  storageKey,
  renderItem,
  itemClassName,
  className,
  hiddenIds,
  onHide,
}: SortableListProps<T>) {
  const allIds = items.map((i) => i.id);
  const [order, setOrder] = useState<string[]>(() => reconcileOrder(readOrder(storageKey), allIds));

  useEffect(() => {
    setOrder((prev) => {
      const next = reconcileOrder(prev, allIds);
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds.join("|")]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      writeOrder(storageKey, next);
      return next;
    });
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((x): x is T => Boolean(x))
    .filter((x) => !hiddenIds?.has(x.id));
  const visibleIds = ordered.map((x) => x.id);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
        <div className={className}>
          <AnimatePresence mode="popLayout" initial={false}>
            {ordered.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: -12, height: 0, marginTop: 0, marginBottom: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                style={{ overflow: "hidden" }}
              >
                <SortableItem id={item.id} className={itemClassName} onHide={onHide}>
                  {(handle, hideButton) => renderItem(item, handle, hideButton)}
                </SortableItem>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </SortableContext>
    </DndContext>
  );
}
