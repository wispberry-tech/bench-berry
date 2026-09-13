<script>
  export const meta = { title: 'Button', props: { variant: 'primary', label: 'Label' } };
</script>

<button class="btn">{meta.props.label}</button>

<style>
  .btn {
    padding: 0.5rem 1rem;
  }
</style>