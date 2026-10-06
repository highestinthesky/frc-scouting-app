<script>
	// /studio has no page of its own and never did — it redirected to the first
	// Studio tab. With the shell merged there is no Studio to land in, so a
	// bookmark or an installed PWA that still opens here goes Home, where a
	// manager's day starts like anyone else's.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	$effect(() => {
		goto(`${base}/home/`, { replaceState: true });
	});
</script>

<p class="wait">Opening…</p>

<style>

	.wait {
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
