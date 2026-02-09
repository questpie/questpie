import type {
	ArrayFieldAdminMeta,
	BaseAdminMeta,
	BooleanFieldAdminMeta,
	DateFieldAdminMeta,
	EmailFieldAdminMeta,
	JsonFieldAdminMeta,
	NumberFieldAdminMeta,
	ObjectFieldAdminMeta,
	RelationFieldAdminMeta,
	SelectFieldAdminMeta,
	TextareaFieldAdminMeta,
	TextFieldAdminMeta,
	TimeFieldAdminMeta,
	UploadFieldAdminMeta,
} from "@questpie/admin";

type ExtendedArrayAdminMeta = ArrayFieldAdminMeta & {
	orderable?: boolean;
	itemLabel?: string | ((item: any, index: number) => string);
	mode?: "inline" | "modal" | "drawer";
	layout?: "stack" | "grid" | "inline";
	columns?: number;
};

type ExtendedObjectAdminMeta = ObjectFieldAdminMeta & {
	wrapper?: "flat" | "card" | "collapsible";
	layout?: "stack" | "grid" | "inline";
	columns?: number;
};

type ExtendedUploadAdminMeta = UploadFieldAdminMeta & {
	previewVariant?: "card" | "compact" | "thumbnail";
	showMetadata?: boolean;
};

declare module "questpie" {
	interface TextFieldMeta {
		admin?: TextFieldAdminMeta;
	}

	interface TextareaFieldMeta {
		admin?: TextareaFieldAdminMeta;
	}

	interface NumberFieldMeta {
		admin?: NumberFieldAdminMeta;
	}

	interface BooleanFieldMeta {
		admin?: BooleanFieldAdminMeta;
	}

	interface DateFieldMeta {
		admin?: DateFieldAdminMeta;
	}

	interface TimeFieldMeta {
		admin?: TimeFieldAdminMeta;
	}

	interface SelectFieldMeta {
		admin?: SelectFieldAdminMeta;
	}

	interface RelationFieldMeta {
		admin?: RelationFieldAdminMeta;
	}

	interface ObjectFieldMeta {
		admin?: ExtendedObjectAdminMeta;
	}

	interface ArrayFieldMeta {
		admin?: ExtendedArrayAdminMeta;
	}

	interface JsonFieldMeta {
		admin?: JsonFieldAdminMeta;
	}

	interface UploadFieldMeta {
		admin?: ExtendedUploadAdminMeta;
	}

	// Additional field types for reactive support
	interface DatetimeFieldMeta {
		admin?: BaseAdminMeta;
	}

	interface EmailFieldMeta {
		admin?: EmailFieldAdminMeta;
	}
}
