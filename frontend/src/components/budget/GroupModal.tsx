import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { budgetApi } from '../../api/budget'

const schema = z.object({ name: z.string().min(1, 'Required') })
type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  group?: { id: number; name: string } | null
}

export function GroupModal({ open, onClose, group }: Props) {
  const qc = useQueryClient()
  const isEdit = !!group

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  })

  useEffect(() => {
    if (open) reset({ name: group?.name ?? '' })
  }, [open, group, reset])

  const mutation = useMutation({
    mutationFn: async (data: FormData): Promise<{ id: number }> => {
      if (isEdit) {
        await budgetApi.updateGroup(group!.id, { name: data.name })
        return { id: group!.id }
      }
      return budgetApi.createGroup({ name: data.name })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => budgetApi.deleteGroup(group!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Group' : 'Add Group'}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <Input label="Group Name" {...register('name')} error={errors.name?.message} autoFocus />

        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}
        {deleteMutation.isError && (
          <p className="text-sm text-danger">{(deleteMutation.error as Error).message}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          {isEdit && (
            <Button
              type="button"
              variant="danger"
              onClick={() => deleteMutation.mutate()}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Save' : 'Add Group'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
