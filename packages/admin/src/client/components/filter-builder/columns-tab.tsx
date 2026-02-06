import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { Checkbox } from "../ui/checkbox";
import type { AvailableField } from "./types.js";

export interface ColumnsTabProps {
  fields: AvailableField[];
  visibleColumns: string[];
  onVisibleColumnsChange: (columns: string[]) => void;
}

interface SortableColumnItemProps {
  field: AvailableField;
  isVisible: boolean;
  onToggle: () => void;
}

function SortableColumnItem({
  field,
  isVisible,
  onToggle,
}: SortableColumnItemProps) {
  const resolveText = useResolveText();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2.5 hover:bg-muted/50 border border-transparent hover:border-border rounded-lg transition-colors ${
        isDragging ? "opacity-50 bg-muted/30" : ""
      }`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
      >
        <Icon icon="ph:dots-six-vertical-bold" width={16} height={16} />
      </button>
      <label className="flex items-center gap-3 flex-1 cursor-pointer">
        <Checkbox checked={isVisible} onCheckedChange={onToggle} />
        <span className="text-sm font-medium">{resolveText(field.label)}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {field.type}
        </span>
      </label>
    </div>
  );
}

/**
 * Sort fields by visibleColumns order:
 * - Visible columns come first (in their stored order from visibleColumns)
 * - Hidden columns come after (in their original order from fields)
 */
function sortFieldsByVisibleColumns(
  fields: AvailableField[],
  visibleColumns: string[],
): AvailableField[] {
  const fieldMap = new Map(fields.map((f) => [f.name, f]));
  const visibleSet = new Set(visibleColumns);

  // First: visible fields in visibleColumns order
  const visibleFields: AvailableField[] = [];
  for (const name of visibleColumns) {
    const field = fieldMap.get(name);
    if (field) {
      visibleFields.push(field);
    }
  }

  // Second: hidden fields in original order
  const hiddenFields = fields.filter((f) => !visibleSet.has(f.name));

  return [...visibleFields, ...hiddenFields];
}

export function ColumnsTab({
  fields,
  visibleColumns,
  onVisibleColumnsChange,
}: ColumnsTabProps) {
  // Local state for field order - maintains drag order
  // Initialize with fields sorted by visibleColumns order
  const [orderedFields, setOrderedFields] = useState<AvailableField[]>(() =>
    sortFieldsByVisibleColumns(fields, visibleColumns),
  );

  // Sync when fields prop changes (but preserve user's reordering)
  useEffect(() => {
    setOrderedFields((prev) => {
      // Keep existing order, add new fields at the end, remove deleted ones
      const existingNames = new Set(prev.map((f) => f.name));
      const newNames = new Set(fields.map((f) => f.name));

      const kept = prev.filter((f) => newNames.has(f.name));
      const added = fields.filter((f) => !existingNames.has(f.name));

      return [...kept, ...added];
    });
  }, [fields]);

  // Sync when visibleColumns changes externally (e.g., loading a saved view)
  // This ensures the field order in the picker matches the stored column order
  useEffect(() => {
    setOrderedFields((prev) => {
      const sorted = sortFieldsByVisibleColumns(prev, visibleColumns);
      // Only update if the order actually changed to avoid unnecessary re-renders
      const prevOrder = prev.map((f) => f.name).join(",");
      const newOrder = sorted.map((f) => f.name).join(",");
      return prevOrder === newOrder ? prev : sorted;
    });
  }, [visibleColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const toggleColumn = (fieldName: string) => {
    if (visibleColumns.includes(fieldName)) {
      onVisibleColumnsChange(visibleColumns.filter((c) => c !== fieldName));
    } else {
      // Add at the end of visible columns in current order
      const newVisible = [...visibleColumns, fieldName];
      // Sort by orderedFields order
      const orderedVisible = orderedFields
        .map((f) => f.name)
        .filter((name) => newVisible.includes(name));
      onVisibleColumnsChange(orderedVisible);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = orderedFields.findIndex((f) => f.name === active.id);
      const newIndex = orderedFields.findIndex((f) => f.name === over.id);

      // Reorder the local fields state
      const reorderedFields = arrayMove(orderedFields, oldIndex, newIndex);
      setOrderedFields(reorderedFields);

      // Update visible columns to match new order
      const newVisibleColumns = reorderedFields
        .map((f) => f.name)
        .filter((name) => visibleColumns.includes(name));

      onVisibleColumnsChange(newVisibleColumns);
    }
  };

  const { t } = useTranslation();

  return (
    <div className="space-y-2 py-4">
      <p className="text-xs text-muted-foreground mb-4">
        {t("viewOptions.columnsDragHint")}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={orderedFields.map((f) => f.name)}
          strategy={verticalListSortingStrategy}
        >
          {orderedFields.map((field) => (
            <SortableColumnItem
              key={field.name}
              field={field}
              isVisible={visibleColumns.includes(field.name)}
              onToggle={() => toggleColumn(field.name)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {orderedFields.length === 0 && (
        <div className="text-center p-8 text-muted-foreground text-sm">
          {t("viewOptions.noFieldsAvailable")}
        </div>
      )}
    </div>
  );
}
