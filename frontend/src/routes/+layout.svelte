<script lang="ts">
	import '../app.css';
	import Navbar from '../lib/Navbar.svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 1000,
				refetchInterval: 5000,
				refetchOnWindowFocus: false
			}
		}
	});
</script>

<QueryClientProvider client={queryClient}>
	<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
		<Navbar />
		<div class="flex flex-grow flex-row justify-center overflow-hidden">
			<div class="flex flex-1 flex-col">
				<main class="flex-1 overflow-y-auto">
					<div class="relative h-full">
						<slot />
					</div>
				</main>
			</div>
		</div>
	</div>
</QueryClientProvider>
