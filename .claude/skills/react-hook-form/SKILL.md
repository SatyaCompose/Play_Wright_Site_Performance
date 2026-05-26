---
name: react-hook-form
description: Manages form state and validation with React Hook Form 7.x and Yup resolvers for KWH e-commerce forms (checkout, account, address, contact).
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# React-hook-form Skill

React Hook Form 7.x is the standard form solution across all KWH frontend forms. It integrates with Yup via `@hookform/resolvers` for schema-based validation, and pairs with Tailwind CSS classes and CSS Modules for styling. All user-facing forms — checkout, account registration, address management, and contact — use this pattern.

## Quick Start

```tsx
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

const schema = yup.object({
  email: yup.string().email('Invalid email').required('Email is required'),
  password: yup.string().min(8, 'Minimum 8 characters').required('Password is required'),
});

type FormValues = yup.InferType<typeof schema>;

export function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: yupResolver(schema) });

  const onSubmit = async (data: FormValues) => {
    // call frontastic action dispatcher
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}
      <button type="submit" disabled={isSubmitting}>Submit</button>
    </form>
  );
}
```

## Key Concepts

- **`useForm<T>`** — always generic-typed; use `yup.InferType<typeof schema>` as `T` to keep types and validation in sync.
- **`yupResolver`** — imported from `@hookform/resolvers/yup`; passed as `resolver` option to `useForm`.
- **`register`** — spreads `name`, `ref`, `onChange`, `onBlur` onto native inputs; use for simple fields.
- **`Controller`** — wraps controlled third-party components (custom selects, date pickers) that don't expose a ref.
- **`formState`** — destructure `errors`, `isSubmitting`, `isDirty`, `isValid` as needed; avoid spreading the whole object.
- **`reset`** — call after successful submission or when resetting to server state (e.g., after address save).
- **`setValue` / `watch`** — use sparingly; prefer uncontrolled inputs via `register` where possible.
- **`trigger`** — manually trigger validation for multi-step checkout flows before advancing steps.

## Common Patterns

### Checkout multi-step form
Each checkout step is its own `useForm` instance scoped to that step's schema. Pass `trigger` up to the parent step controller to validate before advancing:

```tsx
const { trigger, getValues } = useForm<StepOneValues>({ resolver: yupResolver(stepOneSchema) });

const handleNext = async () => {
  const valid = await trigger();
  if (valid) onNext(getValues());
};
```

### Address form with default values
Pre-populate from saved address data using `defaultValues`; re-initialize when the selected address changes with `reset`:

```tsx
const methods = useForm<AddressValues>({
  resolver: yupResolver(addressSchema),
  defaultValues: mapAddressToForm(savedAddress),
});

useEffect(() => {
  methods.reset(mapAddressToForm(savedAddress));
}, [savedAddress]);
```

### Displaying field errors with next-intl
Yup messages are translation keys; resolve them via `useTranslations` before passing to the schema:

```tsx
const t = useTranslations('validation');
const schema = yup.object({
  email: yup.string().email(t('invalidEmail')).required(t('required')),
});
```

### Controlled select with `Controller`
```tsx
<Controller
  name="country"
  control={control}
  render={({ field, fieldState }) => (
    <Select {...field} error={fieldState.error?.message} options={countryOptions} />
  )}
/>
```

### Async submission error handling
Catch action dispatcher errors and set them on the form using `setError`:

```tsx
const { setError } = useForm<FormValues>({ resolver: yupResolver(schema) });

const onSubmit = async (data: FormValues) => {
  try {
    await accountActions.updatePassword(data);
  } catch (err) {
    setError('root.serverError', { message: t('updateFailed') });
  }
};
```