import { TypeCompiler, TypeCheck } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";
import { ZettelDocJsonSchema, type ZettelDoc } from "./schema.js";

// Lazily initialize to avoid evaluating TypeBox's compiler at module load in
// CSP-restricted runtimes (e.g. Cloudflare Workers).
let cachedValidator: TypeCheck<typeof ZettelDocJsonSchema> | undefined;

function getValidator() {
	if (cachedValidator) {
		return cachedValidator;
	}

	try {
		// Prefer compiled validator for speed when eval is permitted.
		cachedValidator = TypeCompiler.Compile(ZettelDocJsonSchema);
	} catch {
		// Fall back to dynamic checking when code generation is blocked.
		cachedValidator = new TypeCheck(
			ZettelDocJsonSchema,
			[],
			(value) => Value.Check(ZettelDocJsonSchema, value),
			""
		);
	}

	return cachedValidator;
}

export type SerializableError = { message: string };

export type ValidationResult<T> =
	| {
			success: true;
			data: T;
			errors: undefined;
	  }
	| {
			success: false;
			data: undefined;
			errors: SerializableError[];
	  };

/**
 * Validates a Zettel AST without throwing an error.
 *
 * @example
 *   const result = validate(zettel);
 *   if (!result.success) {
 *     console.error(result.errors);
 *   } else {
 *     console.log(result.data);
 *   }
 */
export function validate(zettel: unknown): ValidationResult<ZettelDoc> {
	const validator = getValidator();
	const result = validator.Check(zettel);
	if (!result) {
		const errors = [...validator.Errors(zettel)];
		return {
			success: false,
			data: undefined,
			errors: errors.map((error) => ({ message: error.message })),
		};
	}
	return {
		success: true,
		data: zettel as ZettelDoc,
		errors: undefined,
	};
}
