export enum RoutePrefix {
  // Must reflect the routes dir layout
  Root = '/',
  Api = '/api',
  // Answered by the edge with 404 and reached by agents over the VPC, so a
  // route added here is unreachable from the internet the moment it is written.
  Internal = '/internal',
}
