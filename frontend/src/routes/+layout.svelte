<script lang="ts">
	import '../app.css';
	import Navbar from '../lib/Navbar.svelte';
	import Sidebar from '../lib/Sidebar.svelte';
	import MobileTabBar from '../lib/MobileTabBar.svelte';
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
		<div class="flex min-w-0 flex-grow flex-row overflow-hidden">
			<Sidebar />
			<main class="min-w-0 flex-1 overflow-y-auto">
				<div class="relative h-full min-w-0">
					<slot />
				</div>
			</main>
		</div>
		<MobileTabBar />
	</div>
</QueryClientProvider>
